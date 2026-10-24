// Messages between the main thread and the sim worker. Everything here is
// plain JSON-compatible data (structured-clone safe). See docs/ARCHITECTURE.md §3.

import type { BoardSize } from '../domain/breadboard/spec';
import type { Circuit } from '../domain/circuit/circuit';
import type { Command, CommandError } from '../domain/circuit/commands';
import type { SimResult } from '../domain/sim/solver';

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
  | { readonly v: 1; readonly id: number; readonly kind: 'command'; readonly cmd: Command };

export type SimErrorCode = CommandError['code'] | 'BAD_REQUEST' | 'INTERNAL';

export type SimResponse =
  | {
      readonly v: 1;
      readonly kind: 'response';
      readonly id: number;
      readonly ok: true;
      readonly result: { readonly id?: string };
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
}

export type SimPush =
  | {
      readonly v: 1;
      readonly kind: 'circuit';
      readonly revision: number;
      readonly circuit: Circuit;
    }
  | { readonly v: 1; readonly kind: 'frame'; readonly frame: SimFrame };

/** Sim worker → main thread. Pushes for a change always arrive before its response. */
export type SimMessage = SimResponse | SimPush;
