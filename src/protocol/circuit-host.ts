// The UI's one door into the authoritative Circuit. Phase 1 implements it on
// the main thread (ui/local-circuit-host.ts); Phase 2 implements it as a
// client of the sim worker. Callers must not care which. See docs/DECISIONS.md D-010.

import type { Circuit } from '../domain/circuit/circuit';
import type { Command, CommandError } from '../domain/circuit/commands';

export type { Command, CommandError } from '../domain/circuit/commands';

export type HostResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: CommandError };

export interface CircuitHost {
  /** Apply one edit. Resolves after the authoritative circuit has changed (or refused). */
  apply(cmd: Command): Promise<HostResult>;
  /** Called with the current circuit immediately, then after every successful edit. */
  subscribe(listener: (circuit: Circuit) => void): () => void;
}
