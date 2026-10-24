// Interim Phase 1 host: keeps the Circuit on the main thread. Replaced by the
// sim-worker host in Phase 2 behind the same CircuitHost interface (D-010).

import { emptyCircuit, type Circuit } from '../domain/circuit/circuit';
import { applyCommand } from '../domain/circuit/commands';
import type { CircuitHost, Command, HostResult } from '../protocol/circuit-host';

export class LocalCircuitHost implements CircuitHost {
  private circuit: Circuit;
  private readonly listeners = new Set<(c: Circuit) => void>();

  constructor(initial: Circuit = emptyCircuit()) {
    this.circuit = initial;
  }

  apply(cmd: Command): Promise<HostResult> {
    // Round-trip through JSON so nothing that would not survive postMessage sneaks in.
    const result = applyCommand(this.circuit, JSON.parse(JSON.stringify(cmd)) as Command);
    if (!result.ok) return Promise.resolve({ ok: false, error: result.error });
    this.circuit = result.circuit;
    for (const l of this.listeners) l(this.circuit);
    return Promise.resolve({ ok: true, id: result.id });
  }

  subscribe(listener: (c: Circuit) => void): () => void {
    this.listeners.add(listener);
    listener(this.circuit);
    return () => this.listeners.delete(listener);
  }
}
