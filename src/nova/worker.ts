// The nova worker: Pyodide + vendored NovaLang + Breadboard's host.py. Loaded
// lazily the first time the scripting panel opens (docs/ARCHITECTURE.md §3).
//
// Bridge calls are synchronous for the script: post the request to the sim
// worker on the bridge port, then block in Atomics.wait until the sim worker
// writes the response into the shared buffer (protocol/sync-buffer.ts).

import hostSource from './host.py?raw';
import type { PyodideAPI } from 'pyodide';
import { awaitResponse, resetResponse } from '../protocol/sync-buffer';
import type { NovaMessage, NovaRequest } from '../protocol/nova-protocol';
import { NovaRuntime } from './runtime';

/** Network and storage globals removed before any script runs (NOVALANG_ISOLATION.md §2). */
const STRIPPED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
] as const;

/** A bridge call that gets no answer in this long means the sim worker is gone. */
const BRIDGE_TIMEOUT_MS = 30_000;

const scope = self as unknown as DedicatedWorkerGlobalScope & Record<string, unknown>;
const post = (m: NovaMessage): void => scope.postMessage(m);

let runtime: NovaRuntime | null = null;
let port: MessagePort | null = null;
let bridgeBuffer: SharedArrayBuffer | null = null;
let interrupt: Uint8Array | null = null;

function transport(request: string): string {
  resetResponse(bridgeBuffer!);
  port!.postMessage(request);
  const reply = awaitResponse(bridgeBuffer!, BRIDGE_TIMEOUT_MS);
  if (reply === null) {
    return JSON.stringify({
      v: 2,
      id: -1,
      ok: false,
      error: { code: 'TIMEOUT', message: 'the sim worker did not answer' },
    });
  }
  return reply;
}

async function init(
  msg: Extract<NovaRequest, { kind: 'init' }>,
  bridgePort: MessagePort,
): Promise<void> {
  const t0 = performance.now();
  port = bridgePort;
  bridgeBuffer = msg.bridgeBuffer;
  interrupt = new Uint8Array(msg.interruptBuffer);
  const { loadPyodide } = (await import(/* @vite-ignore */ `${msg.base}pyodide/pyodide.mjs`)) as {
    loadPyodide: (o: { indexURL: string }) => Promise<PyodideAPI>;
  };
  const py = await loadPyodide({ indexURL: `${msg.base}pyodide/` });
  const novalang = await (await fetch(`${msg.base}nova/novalang.py`)).text();
  runtime = NovaRuntime.create(py, { novalang, host: hostSource });
  runtime.setInterruptBuffer(interrupt);

  // From here on nothing may reach the network or storage.
  for (const name of STRIPPED) {
    try {
      delete scope[name];
    } catch {
      /* non-configurable: shadow it below */
    }
    if (scope[name] !== undefined) {
      Object.defineProperty(scope, name, {
        value: undefined,
        configurable: false,
        writable: false,
      });
    }
  }
  const blocked = (): never => {
    throw new Error('package loading is disabled in Breadboard scripts');
  };
  py.loadPackage = blocked as unknown as PyodideAPI['loadPackage'];
  py.loadPackagesFromImports = blocked as unknown as PyodideAPI['loadPackagesFromImports'];

  post({
    kind: 'ready',
    pyodide: py.version,
    python: String(py.runPython('import sys; sys.version.split()[0]')),
    stripped: STRIPPED.filter((n) => scope[n] === undefined),
    fetchType: typeof scope['fetch'],
    loadMs: Math.round(performance.now() - t0),
  });
}

function run(msg: Extract<NovaRequest, { kind: 'run' }>): void {
  const t0 = performance.now();
  interrupt![0] = 0;
  let outcome: ReturnType<NovaRuntime['run']>;
  try {
    outcome = runtime!.run(
      msg.source,
      transport,
      {
        stdout: (text) => post({ kind: 'stdout', id: msg.id, text }),
        stderr: (text) => post({ kind: 'stderr', id: msg.id, text }),
      },
      msg.maxCalls,
    );
  } catch (e) {
    // Pyodide itself failed (e.g. its stack overflowed): this worker cannot be
    // trusted again. Report the run, then ask to be replaced.
    const message = e instanceof Error ? e.message : String(e);
    post({ kind: 'done', id: msg.id, ok: false, error: { kind: 'internal', message }, ms: 0 });
    post({ kind: 'fatal', message: `Pyodide failed: ${message}` });
    return;
  }
  const ms = Math.round(performance.now() - t0);
  post(
    outcome.ok
      ? { kind: 'done', id: msg.id, ok: true, ms }
      : {
          kind: 'done',
          id: msg.id,
          ok: false,
          error: { kind: outcome.kind, message: outcome.message },
          ms,
        },
  );
}

scope.onmessage = (event: MessageEvent<NovaRequest>) => {
  const msg = event.data;
  try {
    if (msg.kind === 'init')
      void init(msg, event.ports[0]!).catch((e) => post({ kind: 'fatal', message: String(e) }));
    else if (msg.kind === 'run') run(msg);
  } catch (e) {
    post({ kind: 'fatal', message: e instanceof Error ? e.message : String(e) });
  }
};
