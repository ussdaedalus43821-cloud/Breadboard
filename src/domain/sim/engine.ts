// Sim time. A fixed-step engine around the Stage-1 solver: 1 tick = 1 ms
// (1 kHz). Chip outputs change only on ticks, each gate `delayTicks` after
// the inputs that caused it (inertial delay: a pulse shorter than the delay
// never reaches the output). See docs/ARCHITECTURE.md §4b, D-021.
//
// Order within one step from tick t to t+1:
//   1. Apply output changes scheduled for t+1.
//   2. Re-solve the circuit with the new outputs.
//   3. Evaluate every gate on the solved levels; schedule changes at t+1+delay.
// Edits (load) re-solve and schedule at the current tick without advancing,
// so an input change is visible at once but its effect on outputs is not.

import { pin, terminalKey, type TerminalKey } from '../breadboard/terminal';
import type { Circuit } from '../circuit/circuit';
import { getPartDef } from '../parts/registry';
import type { Level } from './levels';
import { overdrivenLeds, solve, type SimResult } from './solver';

export const TICK_MS = 1;

export interface SimTime {
  readonly ticks: number;
  readonly ms: number;
}

interface Pending {
  readonly at: number;
  readonly value: Level;
}

export class Simulation {
  private circuit: Circuit;
  private ticks = 0;
  /** What each chip output pin drives now. Absent = Z (not yet driving). */
  private outputs = new Map<TerminalKey, Level>();
  private pending = new Map<TerminalKey, Pending>();
  /** LEDs destroyed by over-current (part id → mA that killed them). Cleared only by removing the LED. */
  private burnt = new Map<string, number>();
  /** Chip block state (flip-flop Q, decoder latch), keyed `<part>#<block>`. */
  private states = new Map<string, unknown>();
  /** Per-solve cache: terminal key → level. */
  private levelCache: Map<TerminalKey, Level> | null = null;
  private solved: SimResult;

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    this.solved = this.solveNow();
    this.schedule();
  }

  get time(): SimTime {
    return { ticks: this.ticks, ms: this.ticks * TICK_MS };
  }

  get result(): SimResult {
    return this.solved;
  }

  /** No output change is waiting to happen. */
  get settled(): boolean {
    return this.pending.size === 0;
  }

  /** Level a chip output pin is driving right now (`Z` if none). */
  outputLevel(key: TerminalKey): Level {
    return this.outputs.get(key) ?? 'Z';
  }

  /**
   * Replace the circuit after an edit. Outputs of chips that are still there
   * keep their state; outputs of removed chips stop driving. Time does not move.
   */
  load(circuit: Circuit): void {
    this.circuit = circuit;
    const live = new Set(this.outputPins());
    for (const map of [this.outputs, this.pending] as Map<TerminalKey, unknown>[]) {
      for (const key of map.keys()) if (!live.has(key)) map.delete(key);
    }
    const parts = new Set(circuit.parts.map((p) => p.id));
    const owner = (key: string): string => key.split(/[:#]/)[0]!;
    for (const id of this.burnt.keys()) if (!parts.has(owner(id))) this.burnt.delete(id);
    for (const id of this.states.keys()) if (!parts.has(owner(id))) this.states.delete(id);
    this.solved = this.solveNow();
    this.schedule();
  }

  /** Level of the net a terminal is on, per the current solve. */
  levelOf(key: TerminalKey): Level {
    if (!this.levelCache) {
      this.levelCache = new Map();
      for (const net of this.solved.nets)
        for (const k of net.terminals) this.levelCache.set(k, net.level);
    }
    return this.levelCache.get(key) ?? 'Z';
  }

  /**
   * Advance `n` ticks. Returns true if anything observable changed on the way
   * (a chip output, or a clock lead's level). `onTick` runs after each tick.
   */
  step(n = 1, onTick?: (tick: number) => void): boolean {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const now = this.ticks + 1;
      let applied = this.clockToggles(now);
      for (const [key, p] of this.pending) {
        if (p.at > now) continue;
        this.pending.delete(key);
        if (this.outputLevel(key) !== p.value) {
          if (p.value === 'Z') this.outputs.delete(key);
          else this.outputs.set(key, p.value);
          applied = true;
        }
      }
      this.ticks = now;
      if (applied) {
        changed = true;
        this.solved = this.solveNow();
        this.schedule();
      }
      onTick?.(now);
    }
    return changed;
  }

  /** True if any clock lead changes level at tick `t`. */
  private clockToggles(t: number): boolean {
    return this.circuit.supplies.some(
      (s) => s.kind === 'clock' && t % ((s.periodTicks ?? 10) / 2) === 0,
    );
  }

  /** IDs of LEDs that have burned out. */
  get burntLeds(): ReadonlySet<string> {
    return new Set(this.burnt.keys());
  }

  /**
   * Solve, then burn out any LED driven past its limit and solve again with it
   * open, until no more burn. Burning is instant: it does not wait for a tick.
   */
  private solveNow(): SimResult {
    for (;;) {
      this.levelCache = null;
      const result = solve(this.circuit, this.outputs, this.burnt, this.ticks);
      const killed = overdrivenLeds(this.circuit, result);
      if (killed.size === 0) return result;
      for (const [id, milliamps] of killed) this.burnt.set(id, milliamps);
    }
  }

  /** Step until nothing is pending, at most `limit` ticks. Returns ticks taken. */
  settle(limit = 1000): number {
    const start = this.ticks;
    while (!this.settled && this.ticks - start < limit) this.step();
    return this.ticks - start;
  }

  private *outputPins(): Iterable<TerminalKey> {
    for (const part of this.circuit.parts) {
      const logic = getPartDef(part.type).logic;
      if (!logic) continue;
      for (const b of logic.blocks) for (const o of b.outputs) yield terminalKey(pin(part.id, o));
    }
  }

  /**
   * Evaluate every chip block on the current solve, updating block state (a
   * flip-flop sees its clock edge here), and (re)schedule or cancel output
   * changes. An unpowered chip drives nothing and keeps its state.
   */
  private schedule(): void {
    const at = (part: string, name: string): Level => this.levelOf(terminalKey(pin(part, name)));

    for (const part of this.circuit.parts) {
      const logic = getPartDef(part.type).logic;
      if (!logic) continue;
      const powered = at(part.id, logic.vcc) === 1 && at(part.id, logic.gnd) === 0;
      logic.blocks.forEach((block, i) => {
        let targets: Readonly<Record<string, Level>>;
        if (powered) {
          const key = `${part.id}#${i}`;
          const inputs: Record<string, Level> = {};
          for (const name of block.inputs) inputs[name] = at(part.id, name);
          const r = block.eval(inputs, this.states.has(key) ? this.states.get(key) : block.initial);
          this.states.set(key, r.state);
          targets = r.outputs;
        } else {
          targets = Object.fromEntries(block.outputs.map((o) => [o, 'Z' as Level]));
        }
        for (const out of block.outputs) {
          const key = terminalKey(pin(part.id, out));
          const target = targets[out] ?? 'X';
          if (target === this.outputLevel(key)) {
            this.pending.delete(key); // inertial: the change was undone before it landed
          } else if (this.pending.get(key)?.value !== target) {
            this.pending.set(key, { at: this.ticks + logic.delayTicks, value: target });
          }
        }
      });
    }
  }
}
