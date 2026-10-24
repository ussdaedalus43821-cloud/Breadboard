// Messages between the main thread and the sim worker. Everything here is
// plain JSON-compatible data (structured-clone safe). See docs/ARCHITECTURE.md §3.

import type { BoardSize } from '../domain/breadboard/spec';
import type { Circuit } from '../domain/circuit/circuit';
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
  | { readonly v: 1; readonly id: number; readonly kind: 'clock'; readonly running: boolean };

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
