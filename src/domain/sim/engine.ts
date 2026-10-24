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
import { solve, type SimResult } from './solver';

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
  private solved: SimResult;

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    this.solved = solve(circuit, this.outputs);
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
    this.solved = solve(circuit, this.outputs);
    this.schedule();
  }

  /** Advance `n` ticks. Returns true if any output changed on the way. */
  step(n = 1): boolean {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const now = this.ticks + 1;
      let applied = false;
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
        this.solved = solve(this.circuit, this.outputs);
        this.schedule();
      }
    }
    return changed;
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
      for (const g of logic.gates) yield terminalKey(pin(part.id, g.output));
    }
  }

  /** Evaluate every gate on the current solve; (re)schedule or cancel output changes. */
  private schedule(): void {
    const levels = new Map<TerminalKey, Level>();
    for (const net of this.solved.nets) for (const k of net.terminals) levels.set(k, net.level);
    const at = (part: string, name: string): Level =>
      levels.get(terminalKey(pin(part, name))) ?? 'Z';

    for (const part of this.circuit.parts) {
      const logic = getPartDef(part.type).logic;
      if (!logic) continue;
      const powered = at(part.id, logic.vcc) === 1 && at(part.id, logic.gnd) === 0;
      for (const g of logic.gates) {
        const key = terminalKey(pin(part.id, g.output));
        const target: Level = powered ? g.fn(g.inputs.map((name) => at(part.id, name))) : 'Z';
        if (target === this.outputLevel(key)) {
          this.pending.delete(key); // inertial: the change was undone before it landed
        } else if (this.pending.get(key)?.value !== target) {
          this.pending.set(key, { at: this.ticks + logic.delayTicks, value: target });
        }
      }
    }
  }
}
