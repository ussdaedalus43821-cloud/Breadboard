// Main-thread side of the nova worker: lazy start, bridge hookup, runs, and the
// watchdog (docs/NOVALANG_ISOLATION.md §3).
//
//   soft stop  at timeoutMs:        write SIGINT (2) into Pyodide's interrupt buffer
//   hard kill  at timeoutMs + 1 s:  worker.terminate(); the next run starts a new worker
//
// Messages from the worker are untrusted data: only known kinds are handled, and
// text is only ever shown as text.

import type { AttachBridge, NovaMessage, NovaRequest } from '../protocol/nova-protocol';
import { createResponseBuffer } from '../protocol/sync-buffer';

export interface ReadyInfo {
  readonly pyodide: string;
  readonly python: string;
  readonly stripped: readonly string[];
  readonly fetchType: string;
  readonly loadMs: number;
}

export interface RunResult {
  readonly ok: boolean;
  /** `error`, `timeout` (soft stop), `killed` (hard kill), `stopped` (Stop button) or `internal`. */
  readonly kind?: string;
  readonly message?: string;
  readonly ms: number;
}

export interface RunOptions {
  readonly timeoutMs: number;
  onStdout(text: string): void;
  onStderr(text: string): void;
}

export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 1000;

export class NovaClient {
  private worker: Worker | null = null;
  private ready: Promise<ReadyInfo> | null = null;
  private interrupt: Uint8Array | null = null;
  private nextId = 1;
  private active: {
    id: number;
    opts: RunOptions;
    resolve: (r: RunResult) => void;
    timers: number[];
    t0: number;
  } | null = null;

  constructor(
    private readonly spawn: () => Worker,
    /** Hand the sim worker its end of a fresh bridge channel. */
    private readonly attachBridge: (port: MessagePort, message: AttachBridge) => void,
    private readonly base: string,
  ) {}

  get running(): boolean {
    return this.active !== null;
  }

  /** Start the worker (loading Pyodide) if it is not running yet. */
  start(): Promise<ReadyInfo> {
    this.ready ??= new Promise<ReadyInfo>((resolve, reject) => {
      if (!globalThis.crossOriginIsolated) {
        reject(
          new Error(
            'scripting needs cross-origin isolation (COOP/COEP headers); see docs/ARCHITECTURE.md §3',
          ),
        );
        return;
      }
      const worker = this.spawn();
      this.worker = worker;
      const bridgeBuffer = createResponseBuffer();
      const interruptBuffer = new SharedArrayBuffer(1);
      this.interrupt = new Uint8Array(interruptBuffer);
      const channel = new MessageChannel();
      this.attachBridge(channel.port1, { kind: 'attach-bridge', buffer: bridgeBuffer });

      worker.onmessage = (event: MessageEvent<NovaMessage>) => {
        const m = event.data;
        switch (m?.kind) {
          case 'ready':
            resolve({
              pyodide: m.pyodide,
              python: m.python,
              stripped: m.stripped,
              fetchType: m.fetchType,
              loadMs: m.loadMs,
            });
            break;
          case 'stdout':
          case 'stderr':
            if (this.active?.id === m.id) {
              (m.kind === 'stdout' ? this.active.opts.onStdout : this.active.opts.onStderr)(
                String(m.text),
              );
            }
            break;
          case 'done':
            if (this.active?.id === m.id) {
              this.finish(
                m.ok
                  ? { ok: true, ms: m.ms }
                  : {
                      ok: false,
                      kind: m.error?.kind ?? 'internal',
                      message: m.error?.message ?? '',
                      ms: m.ms,
                    },
              );
            }
            break;
          case 'fatal':
            reject(new Error(String(m.message)));
            this.discard();
            break;
        }
      };
      worker.onerror = (e) => {
        reject(new Error(e.message || 'the nova worker failed to start'));
        this.discard();
      };
      const init: NovaRequest = { kind: 'init', base: this.base, bridgeBuffer, interruptBuffer };
      worker.postMessage(init, [channel.port2]);
    });
    return this.ready;
  }

  async run(source: string, opts: RunOptions): Promise<RunResult> {
    if (this.active) throw new Error('a script is already running');
    await this.start();
    const timeoutMs = Math.min(Math.max(opts.timeoutMs, 100), MAX_TIMEOUT_MS);
    const id = this.nextId++;
    return new Promise<RunResult>((resolve) => {
      const soft = window.setTimeout(() => {
        if (this.interrupt) this.interrupt[0] = 2; // SIGINT → KeyboardInterrupt in Python
      }, timeoutMs);
      const hard = window.setTimeout(() => {
        this.finish({
          ok: false,
          kind: 'killed',
          message: `TIMEOUT (killed): still running ${KILL_GRACE_MS} ms after the soft stop`,
          ms: timeoutMs + KILL_GRACE_MS,
        });
        this.discard();
      }, timeoutMs + KILL_GRACE_MS);
      this.active = { id, opts, resolve, timers: [soft, hard], t0: performance.now() };
      this.interrupt![0] = 0;
      const msg: NovaRequest = { kind: 'run', id, source };
      this.worker!.postMessage(msg);
    });
  }

  /** Stop the running script now: terminate the worker. */
  stop(): void {
    if (!this.active) return;
    this.finish({
      ok: false,
      kind: 'stopped',
      message: 'stopped by the user',
      ms: Math.round(performance.now() - this.active.t0),
    });
    this.discard();
  }

  private finish(result: RunResult): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    for (const t of a.timers) window.clearTimeout(t);
    a.resolve(result);
  }

  /** Throw the worker away; the next start() spawns a fresh one. */
  private discard(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.interrupt = null;
    if (this.active) {
      this.finish({ ok: false, kind: 'internal', message: 'the nova worker stopped', ms: 0 });
    }
  }
}
