// The UI's one door into the authoritative Circuit and its sim state.
// Implemented by ui/worker-circuit-host.ts over the sim worker (D-010, D-015).

import type { Circuit } from '../domain/circuit/circuit';
import type { Command, CommandError } from '../domain/circuit/commands';
import type { SimFrame } from './sim-protocol';

export type { Command, CommandError } from '../domain/circuit/commands';
export type { SimFrame } from './sim-protocol';

export type HostResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly error: CommandError | { readonly code: string; readonly message: string };
    };

export interface CircuitHost {
  /** Apply one edit. Resolves after the circuit and frame for it have been delivered (or refused). */
  apply(cmd: Command): Promise<HostResult>;
  /** Called with the current circuit as soon as there is one, then after every successful edit. */
  subscribe(listener: (circuit: Circuit) => void): () => void;
  /** Called with the latest sim frame as soon as there is one, then after every re-solve. */
  subscribeFrames(listener: (frame: SimFrame) => void): () => void;
}
