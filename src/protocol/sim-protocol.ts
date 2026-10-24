// Messages between the main thread and the sim worker. Everything here is
// plain JSON-compatible data (structured-clone safe). See docs/ARCHITECTURE.md §3.

import type { BoardSize } from '../domain/breadboard/spec';
import type { Circuit } from '../domain/circuit/circuit';
import type { HistoryState } from '../domain/circuit/history';
import type { Level } from '../domain/sim/levels';
import type { Command, CommandError } from '../domain/circuit/commands';
import type { SimTime } from '../domain/sim/engine';
import type { SimResult } from '../domain/sim/solver';

export type { SimTime } from '../domain/sim/engine';

export const SIM_PROTOCOL_VERSION = 1;

/** Anything with postMessage + onmessage: a Worker, the worker's own global, a MessagePort. */
export interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export type SimRequest =
  /** Start (or restart) with a fresh board. `bench` powers the rails; `empty` does not. */
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: 'hello';
      readonly size: BoardSize;
      readonly splitRails?: boolean;
      readonly preset: 'bench' | 'empty';
    }
  | { readonly v: 1; readonly id: number; readonly kind: 'command'; readonly cmd: Command }
  /** Advance exactly `ticks` ticks (1 ≤ ticks ≤ 100 000). The bridge's `board.step`. */
  | { readonly v: 1; readonly id: number; readonly kind: 'step'; readonly ticks: number }
  /** Advance `ms` of sim time (0 < ms ≤ 10 000; rounded up to whole ticks). The bridge's `board.run`. */
  | { readonly v: 1; readonly id: number; readonly kind: 'run'; readonly ms: number }
  /** Start or pause the real-time 1 kHz clock. */
  | { readonly v: 1; readonly id: number; readonly kind: 'clock'; readonly running: boolean }
  /** Replace the circuit with a fresh board, as one undoable edit (Clear board, board.new). */
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: 'reset';
      readonly size: BoardSize;
      readonly preset: 'bench' | 'empty';
    }
  /** Replace the circuit with a save file (domain/circuit/save.ts), as one undoable edit. */
  | { readonly v: 1; readonly id: number; readonly kind: 'load'; readonly save: unknown }
  | { readonly v: 1; readonly id: number; readonly kind: 'undo' | 'redo' }
  /** Logic analyzer: record these terminals (up to 4) every tick; replaces the list. */
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: 'probes';
      readonly terminals: readonly string[];
    }
  /** Open or close an undo group: every edit in between undoes as one (a script run). */
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: 'group';
      readonly open: boolean;
      readonly label?: string;
    };

export type SimErrorCode = CommandError['code'] | 'LIMIT' | 'BAD_REQUEST' | 'INTERNAL';

/** Caps from docs/NOVALANG_BRIDGE.md §6. */
export const MAX_STEP_TICKS = 100_000;
export const MAX_RUN_MS = 10_000;

export type SimResponse =
  | {
      readonly v: 1;
      readonly kind: 'response';
      readonly id: number;
      readonly ok: true;
      readonly result: { readonly id?: string; readonly time?: SimTime };
    }
  | {
      readonly v: 1;
      readonly kind: 'response';
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly code: SimErrorCode; readonly message: string };
    };

/** One solved state of the circuit at `revision`. */
export interface SimFrame extends SimResult {
  readonly revision: number;
  readonly time: SimTime;
  /** No chip output change is pending. */
  readonly settled: boolean;
  /** The real-time clock is running. */
  readonly running: boolean;
  readonly history: HistoryState;
  /** Logic analyzer: the last 50 ticks at each probed terminal. */
  readonly trace: TraceFrame;
}

export type SimPush =
  | {
      readonly v: 1;
      readonly kind: 'circuit';
      readonly revision: number;
      readonly circuit: Circuit;
    }
  | { readonly v: 1; readonly kind: 'frame'; readonly frame: SimFrame }
  /** Time moved but nothing else changed (sent at most ~10× a second). */
  | { readonly v: 1; readonly kind: 'time'; readonly time: SimTime; readonly running: boolean };

/** Sim worker → main thread. Pushes for a change always arrive before its response. */
export type SimMessage = SimResponse | SimPush;

/** Logic-analyzer data in a frame (recorded by the sim worker's Trace). */
export interface TraceFrame {
  readonly probes: readonly string[];
  /** The tick of each sample, oldest first (at most 50). */
  readonly ticks: readonly number[];
  /** levels[p][i]: probe p at ticks[i]. */
  readonly levels: readonly (readonly Level[])[];
}
