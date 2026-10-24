// The NovaLang bridge wire format: docs/NOVALANG_BRIDGE.md §5. Plain JSON.

/** Contract version. v2 added board.resistor (D-031); v1 requests are still accepted. */
export const BRIDGE_VERSION = 2;
export const BRIDGE_VERSIONS_ACCEPTED: readonly number[] = [1, 2];

/** Every op a script can reach. Nothing else is dispatched (no eval, no raw). */
export const BRIDGE_COMMANDS = [
  'board.new',
  'board.switch',
  'board.led',
  'board.chip',
  'board.wire',
  'board.power',
  'board.ground',
  'board.set',
  'board.run',
  'board.step',
  'board.resistor',
] as const;
export const BRIDGE_QUERIES = ['sim.get', 'sim.snapshot', 'sim.time'] as const;
export const BRIDGE_OPS: readonly string[] = [...BRIDGE_COMMANDS, ...BRIDGE_QUERIES];
export type BridgeOp = (typeof BRIDGE_COMMANDS)[number] | (typeof BRIDGE_QUERIES)[number];

export type BridgeErrorCode =
  | 'BAD_ARGS'
  | 'BAD_TERMINAL'
  | 'BAD_PLACEMENT'
  | 'OCCUPIED'
  | 'UNKNOWN_PART'
  | 'UNKNOWN_TYPE'
  | 'LIMIT'
  | 'TIMEOUT'
  | 'INTERNAL';

export interface BridgeRequest {
  readonly v: number;
  readonly id: number;
  readonly op: string;
  readonly args: readonly unknown[];
}

export type BridgeResponse =
  | { readonly v: number; readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly v: number;
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly code: BridgeErrorCode; readonly message: string };
    };

/** Caps from docs/NOVALANG_BRIDGE.md §6 that the sim side enforces. */
export const MAX_PARTS = 200;
export const MAX_WIRES = 1000;
/** Enforced by the Python proxy, per script run. */
export const MAX_BRIDGE_CALLS = 100_000;
