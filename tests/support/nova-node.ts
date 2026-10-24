// NovaLang under Pyodide in Node, wired straight to a SimService through the
// real bridge dispatcher: the browser path minus the two workers and the
// shared-memory hop (which the Playwright run covers).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { NovaRuntime, type RunOutcome, type Transport } from '../../src/nova/runtime';
import type { SimMessage } from '../../src/protocol/sim-protocol';
import { handleBridge } from '../../src/worker/bridge';
import { SimService } from '../../src/worker/sim-service';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

let shared: Promise<NovaRuntime> | null = null;

/** One Pyodide + NovaLang runtime per test file (loading takes a second or two). */
export function novaRuntime(): Promise<NovaRuntime> {
  shared ??= loadPyodide().then((py) =>
    NovaRuntime.create(py, {
      novalang: read('public/nova/novalang.py'),
      host: read('src/nova/host.py'),
    }),
  );
  return shared;
}

export interface Bench {
  readonly service: SimService;
  readonly transport: Transport;
  /** Every circuit/frame push the UI would have received. */
  readonly pushes: SimMessage[];
  /** Run a script; collect its stdout/stderr lines. */
  run(
    source: string,
    maxCalls?: number,
  ): Promise<{ outcome: RunOutcome; stdout: string[]; stderr: string[] }>;
}

export function bench(service = new SimService()): Bench {
  const pushes: SimMessage[] = [];
  const transport: Transport = (request) => {
    const { response, pushes: p } = handleBridge(service, request);
    pushes.push(...p);
    return JSON.stringify(response);
  };
  return {
    service,
    transport,
    pushes,
    async run(source, maxCalls) {
      const rt = await novaRuntime();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const outcome = rt.run(
        source,
        transport,
        { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
        maxCalls,
      );
      return { outcome, stdout, stderr };
    },
  };
}
