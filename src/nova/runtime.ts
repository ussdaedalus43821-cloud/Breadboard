// Loads vendored NovaLang and Breadboard's host.py into a Pyodide instance and
// runs scripts. Shared by the nova worker (browser) and the tests (Node).

import type { PyodideAPI } from 'pyodide';

export interface NovaSources {
  /** public/nova/novalang.py, unmodified. */
  readonly novalang: string;
  /** src/nova/host.py. */
  readonly host: string;
}

export type RunOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: 'error' | 'timeout' | 'internal';
      readonly message: string;
    };

export interface RunIO {
  stdout(line: string): void;
  stderr(line: string): void;
}

/** Request JSON in, response JSON out, synchronously. */
export type Transport = (request: string) => string;

export class NovaRuntime {
  private constructor(private readonly py: PyodideAPI) {}

  static create(py: PyodideAPI, sources: NovaSources): NovaRuntime {
    py.FS.mkdirTree('/nova');
    py.FS.writeFile('/nova/novalang.py', sources.novalang);
    py.FS.writeFile('/nova/breadboard_host.py', sources.host);
    // input() has no terminal here: stdin is always at end-of-input, which
    // NovaLang reports as a catchable "input() found no more input to read".
    py.setStdin({ stdin: () => null });
    py.runPython('import sys\nsys.path.insert(0, "/nova")\nimport breadboard_host');
    return new NovaRuntime(py);
  }

  /** Shared byte the watchdog sets to 2 (SIGINT) to stop a running script. */
  setInterruptBuffer(buffer: Uint8Array): void {
    this.py.setInterruptBuffer(buffer);
  }

  /** The public names on `board` and `sim`, as the host exposes them. */
  publicApi(): { board: string[]; sim: string[] } {
    return JSON.parse(this.py.runPython('breadboard_host.public_api()') as string);
  }

  run(source: string, transport: Transport, io: RunIO, maxCalls?: number): RunOutcome {
    this.py.setStdout({ batched: (line) => io.stdout(line) });
    this.py.setStderr({ batched: (line) => io.stderr(line) });
    const runScript = this.py.globals.get('breadboard_host').run_script;
    try {
      const raw =
        maxCalls === undefined
          ? runScript(source, transport)
          : runScript(source, transport, maxCalls);
      return JSON.parse(String(raw)) as RunOutcome;
    } finally {
      runScript.destroy?.();
    }
  }
}
