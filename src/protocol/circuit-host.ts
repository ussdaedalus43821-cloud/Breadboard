// The UI's one door into the authoritative Circuit and its sim state.
// Implemented by ui/worker-circuit-host.ts over the sim worker (D-010, D-015).

import type { Circuit } from '../domain/circuit/circuit';
import type { Command, CommandError } from '../domain/circuit/commands';
import type { BoardSize } from '../domain/breadboard/spec';
import type { SimFrame, SimTime } from './sim-protocol';

export type { Command, CommandError } from '../domain/circuit/commands';
export type { SimFrame, SimTime } from './sim-protocol';

export type HostResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly error: CommandError | { readonly code: string; readonly message: string };
    };

export type TimeResult =
  | { readonly ok: true; readonly time: SimTime }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface ResetOptions {
  readonly size?: BoardSize;
  readonly splitRails?: boolean;
  readonly preset?: 'bench' | 'empty';
}

export interface CircuitHost {
  /** Apply one edit. Resolves after the circuit and frame for it have been delivered (or refused). */
  apply(cmd: Command): Promise<HostResult>;
  /** Called with the current circuit as soon as there is one, then after every successful edit. */
  subscribe(listener: (circuit: Circuit) => void): () => void;
  /** Called with the latest sim frame as soon as there is one, then after every re-solve. */
  subscribeFrames(listener: (frame: SimFrame) => void): () => void;
  /** Advance exactly `ticks` sim ticks (1 tick = 1 ms). */
  step(ticks: number): Promise<TimeResult>;
  /** Advance `ms` of sim time. */
  run(ms: number): Promise<TimeResult>;
  /** Start or pause the real-time 1 kHz clock. */
  setRunning(running: boolean): Promise<TimeResult>;
  /** Start a new session: fresh board, empty undo history. */
  reset(options?: ResetOptions): Promise<void>;
  /** Replace the circuit with a fresh board, as one undoable edit. */
  clear(options?: ResetOptions): Promise<HostResult>;
  /** Replace the circuit with a save file, as one undoable edit. */
  load(save: unknown): Promise<HostResult>;
  undo(): Promise<HostResult>;
  redo(): Promise<HostResult>;
  /** Logic analyzer: probe these terminals (up to 4); replaces the list. */
  setProbes(terminals: readonly string[]): Promise<HostResult>;
  /** Open (true) or close (false) an undo group: everything in between undoes as one. */
  group(open: boolean, label?: string): Promise<HostResult>;
}
