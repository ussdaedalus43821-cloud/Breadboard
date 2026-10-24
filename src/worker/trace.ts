// Logic-analyzer trace: the level at up to 4 probed terminals for each of the
// last 50 ticks. Recorded in the sim worker, where every tick happens; frames
// only carry the result.

import type { TerminalKey } from '../domain/breadboard/terminal';
import type { Level } from '../domain/sim/levels';
import type { TraceFrame } from '../protocol/sim-protocol';

export const TRACE_TICKS = 50;
export const MAX_PROBES = 4;

export class Trace {
  private probes: TerminalKey[] = [];
  private ticks: number[] = [];
  private levels: Level[][] = [];

  get active(): boolean {
    return this.probes.length > 0;
  }

  /** Replace the probe list; history restarts. */
  setProbes(probes: readonly TerminalKey[]): void {
    this.probes = probes.slice(0, MAX_PROBES);
    this.ticks = [];
    this.levels = this.probes.map(() => []);
  }

  /** Record (or, for the same tick, overwrite) the levels at `tick`. */
  sample(tick: number, levelOf: (key: TerminalKey) => Level): void {
    if (!this.active) return;
    const same = this.ticks.at(-1) === tick;
    if (!same) this.ticks.push(tick);
    this.probes.forEach((key, p) => {
      const row = this.levels[p]!;
      if (same) row[row.length - 1] = levelOf(key);
      else row.push(levelOf(key));
      if (row.length > TRACE_TICKS) row.shift();
    });
    if (this.ticks.length > TRACE_TICKS) this.ticks.shift();
  }

  frame(): TraceFrame {
    return {
      probes: [...this.probes],
      ticks: [...this.ticks],
      levels: this.levels.map((r) => [...r]),
    };
  }
}
