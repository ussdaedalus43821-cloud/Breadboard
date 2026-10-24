// The sim worker's logic, free of worker globals so tests can drive it over a
// MessageChannel. Owns the ONE authoritative Circuit (docs/ARCHITECTURE.md §3).

import { benchCircuit, emptyCircuit, type Circuit } from '../domain/circuit/circuit';
import { applyCommand, type Command } from '../domain/circuit/commands';
import { solve } from '../domain/sim/solver';
import type { PortLike, SimMessage, SimRequest, SimResponse } from '../protocol/sim-protocol';

export class SimService {
  private circuit: Circuit = benchCircuit();
  private revision = 0;

  /** Handle one request; returns the messages to send, pushes first. */
  handle(raw: unknown): SimMessage[] {
    const req = raw as Partial<SimRequest> | null;
    const id = typeof req?.id === 'number' ? req.id : -1;
    try {
      if (!req || req.v !== 1)
        return [this.fail(id, 'BAD_REQUEST', 'missing or unsupported protocol version')];
      switch (req.kind) {
        case 'hello': {
          const options = req.splitRails === undefined ? {} : { splitRails: req.splitRails };
          this.circuit =
            req.preset === 'empty'
              ? emptyCircuit(req.size, options)
              : benchCircuit(req.size, options);
          return [...this.publish(), this.ok(id, {})];
        }
        case 'command': {
          const result = applyCommand(this.circuit, req.cmd as Command);
          if (!result.ok) return [this.fail(id, result.error.code, result.error.message)];
          this.circuit = result.circuit;
          return [...this.publish(), this.ok(id, { id: result.id })];
        }
        default:
          return [this.fail(id, 'BAD_REQUEST', `unknown request kind ${JSON.stringify(req.kind)}`)];
      }
    } catch (e) {
      return [this.fail(id, 'INTERNAL', e instanceof Error ? e.message : String(e))];
    }
  }

  private publish(): SimMessage[] {
    const revision = ++this.revision;
    return [
      { v: 1, kind: 'circuit', revision, circuit: this.circuit },
      { v: 1, kind: 'frame', frame: { revision, ...solve(this.circuit) } },
    ];
  }

  private ok(id: number, result: { id?: string }): SimResponse {
    return { v: 1, kind: 'response', id, ok: true, result };
  }

  private fail(
    id: number,
    code: Extract<SimResponse, { ok: false }>['error']['code'],
    message: string,
  ): SimResponse {
    return { v: 1, kind: 'response', id, ok: false, error: { code, message } };
  }
}

/** Serve a SimService on a port (the worker global, or a MessagePort in tests). */
export function serveSim(port: PortLike, service: SimService = new SimService()): SimService {
  port.onmessage = (event) => {
    for (const message of service.handle(event.data)) port.postMessage(message);
  };
  return service;
}
