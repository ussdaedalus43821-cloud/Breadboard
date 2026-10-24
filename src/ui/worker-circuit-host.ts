// CircuitHost over the sim worker's message protocol. Works with any PortLike:
// a real Worker in the browser, a MessagePort in tests.

import type { BoardSize } from '../domain/breadboard/spec';
import type { Circuit } from '../domain/circuit/circuit';
import type { CircuitHost, Command, HostResult } from '../protocol/circuit-host';
import type { PortLike, SimFrame, SimMessage, SimRequest } from '../protocol/sim-protocol';

export interface HostOptions {
  readonly size?: BoardSize;
  readonly splitRails?: boolean;
  readonly preset?: 'bench' | 'empty';
}

export class WorkerCircuitHost implements CircuitHost {
  /** Resolves once the worker has sent the first circuit and frame. */
  readonly ready: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<number, (r: HostResult) => void>();
  private circuit: Circuit | null = null;
  private frame: SimFrame | null = null;
  private readonly circuitListeners = new Set<(c: Circuit) => void>();
  private readonly frameListeners = new Set<(f: SimFrame) => void>();

  constructor(
    private readonly port: PortLike,
    options: HostOptions = {},
  ) {
    port.onmessage = (event) => this.receive(event.data as SimMessage);
    this.ready = this.request({
      kind: 'hello',
      size: options.size ?? 'half',
      preset: options.preset ?? 'bench',
      ...(options.splitRails === undefined ? {} : { splitRails: options.splitRails }),
    }).then((r) => {
      if (!r.ok) throw new Error(`sim worker refused hello: ${r.error.message}`);
    });
  }

  apply(cmd: Command): Promise<HostResult> {
    return this.request({ kind: 'command', cmd });
  }

  subscribe(listener: (c: Circuit) => void): () => void {
    this.circuitListeners.add(listener);
    if (this.circuit) listener(this.circuit);
    return () => this.circuitListeners.delete(listener);
  }

  subscribeFrames(listener: (f: SimFrame) => void): () => void {
    this.frameListeners.add(listener);
    if (this.frame) listener(this.frame);
    return () => this.frameListeners.delete(listener);
  }

  private request(body: DistributiveOmit<SimRequest, 'v' | 'id'>): Promise<HostResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.port.postMessage({ v: 1, id, ...body });
    });
  }

  private receive(msg: SimMessage): void {
    switch (msg.kind) {
      case 'circuit':
        this.circuit = msg.circuit;
        for (const l of this.circuitListeners) l(msg.circuit);
        break;
      case 'frame':
        this.frame = msg.frame;
        for (const l of this.frameListeners) l(msg.frame);
        break;
      case 'response': {
        const resolve = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve?.(msg.ok ? { ok: true, id: msg.result.id ?? '' } : { ok: false, error: msg.error });
        break;
      }
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
