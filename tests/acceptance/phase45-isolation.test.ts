// What a NovaLang script cannot do: docs/NOVALANG_ISOLATION.md §5. Browser-only
// walls (no fetch, no window) are checked in the Playwright run; everything
// that lives in Python, the host or the bridge is checked here.

import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRIDGE_COMMANDS, BRIDGE_QUERIES } from '../../src/protocol/bridge';
import { NOVA_TOOL_FILES } from '../../src/nova/runtime';
import { bench, novaRuntime, read } from '../support/nova-node';

beforeAll(async () => {
  await novaRuntime();
}, 60_000);

const lines = async (source: string, maxCalls?: number) => {
  const r = await bench().run(source, maxCalls);
  return { ...r, all: [...r.stdout, ...r.stderr] };
};

describe('no path from a script to Python objects (D-032)', () => {
  it('there is no python.* namespace', async () => {
    const { outcome } = await lines('python.import("math")');
    expect(outcome).toMatchObject({
      ok: false,
      message: expect.stringContaining("undefined name 'python'"),
    });
  });

  it('a module the script writes and imports cannot use python.* either', async () => {
    // NovaLang 2.x defines `python` in imported modules, but with the bridge
    // off ([py.off], the default since 2.1) every member fails (D-049).
    const { outcome, stdout } = await lines(
      [
        'write("/tmp/m.nova", "export let p = python")',
        'import "/tmp/m.nova" as m',
        'for k in keys(m.p) {',
        '  try { m.p[k]("json") ; print(k + " OPEN") } catch e { print(k + " " + str(e)) }',
        '}',
      ].join('\n'),
    );
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toHaveLength(4);
    for (const line of stdout)
      expect(line).toMatch(/^(import|call|get|set) .*python\.\* is disabled/);
  });

  it('a script can import a module it wrote (the 2.x type gate runs under Pyodide)', async () => {
    const { outcome, stdout } = await lines(
      'write("/tmp/sq.nova", "export def sq(x) { return x * x }")\nimport "/tmp/sq.nova" as m\nprint(m.sq(7))',
    );
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual(['49']);
  });

  it.each([
    ['an underscore key', 'board["_bridge"]', /no key '_bridge'/],
    ['a dunder key', 'board["__class__"]', /no key '__class__'/],
    ['a function attribute', 'board.new.__globals__', /a function has no fields/],
    ['a function index', 'board.new["__globals__"]', /a function cannot be indexed/],
    ['a result object', 'sim.time()["__class__"]', /no key '__class__'/],
  ])('%s is a dead end: %s', async (_, expr, message) => {
    const { outcome } = await lines(`print(${expr})`);
    expect(outcome).toMatchObject({
      ok: false,
      kind: 'error',
      message: expect.stringMatching(message),
    });
  });

  it("overwriting board.* only changes the script's own copy", async () => {
    const b = bench();
    await b.run('board.new = 5');
    expect((await b.run('print(board.new("half")["rows"])')).stdout).toEqual(['30']);
  });

  it('runaway recursion is a caught script error, not a Pyodide crash', async () => {
    // Since 2.0 NovaLang stops at its own call-depth limit (1200) before
    // Python's recursion limit; host.py still catches RecursionError as a backstop.
    const { outcome } = await lines('def f(n) { return f(n + 1) }\nf(0)');
    expect(outcome).toEqual({
      ok: false,
      kind: 'error',
      message: 'call depth of 1200 exceeded - is the recursion missing a base case?',
    });
    expect(
      (
        await lines(
          'def fib(n) { if n < 2 { return n }\n return fib(n - 1) + fib(n - 2) }\nprint(fib(15))',
        )
      ).stdout,
    ).toEqual(['610']);
  });
});

describe('a script sees board and sim, and only the bridge calls on them', () => {
  it('the public surface is exactly the contract', async () => {
    const api = (await novaRuntime()).publicApi();
    expect(api.board).toEqual(BRIDGE_COMMANDS.map((op) => op.slice('board.'.length)).sort());
    expect(api.sim).toEqual(BRIDGE_QUERIES.map((op) => op.slice('sim.'.length)).sort());
  });

  it('each run starts from a fresh engine', async () => {
    const b = bench();
    await b.run('let secret = 42');
    const { outcome } = await b.run('print(secret)');
    expect(outcome).toMatchObject({ ok: false, kind: 'error' });
  });
});

describe('no host files, no terminal', () => {
  it('read() cannot see the real filesystem', async () => {
    const { stdout } = await lines(`
try { print(read("/home/user/Breadboard/package.json")) } catch e { print(e) }
try { print(read("/etc/passwd")) } catch e { print(e) }
`);
    expect(stdout[0]).toMatch(/^FileNotFoundError/);
    expect(stdout[1]).toMatch(/^FileNotFoundError/);
  });

  it('input() is an error, not a hang', async () => {
    const { stdout } = await lines('try { input("? ") } catch e { print("input:", e) }');
    expect(stdout).toEqual(['? input: input() found no more input to read']); // the prompt prints first
  });

  it('exit(0) ends a script cleanly; exit(3) is reported', async () => {
    expect((await lines('print("a")\nexit(0)\nprint("b")')).stdout).toEqual(['a']);
    expect((await lines('exit(3)')).outcome).toMatchObject({
      ok: false,
      message: 'the script called exit(3)',
    });
  });
});

describe('a script cannot hang the sim or run forever', () => {
  it('the bridge-call cap stops a runaway loop of cheap calls', async () => {
    const { outcome, stdout } = await lines('for i = 0 to 10 { sim.time()\n print(i) }', 5);
    expect(stdout).toEqual(['0', '1', '2', '3', '4']);
    expect(outcome).toMatchObject({
      ok: false,
      message: expect.stringContaining('LIMIT: a script may make at most 5 bridge calls per run'),
    });
  });

  it('the watchdog interrupt stops `while true {}`, and the next script runs normally', async () => {
    const rt = await novaRuntime();
    const sab = new SharedArrayBuffer(1);
    const flag = new Uint8Array(sab);
    rt.setInterruptBuffer(flag);
    // A stand-in for the main-thread watchdog: wait 300 ms, then write SIGINT.
    const watchdog = new Worker(
      `const { workerData } = require('node:worker_threads');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.ms);
       new Uint8Array(workerData.sab)[0] = 2;`,
      { eval: true, workerData: { sab, ms: 300 } },
    );
    const t0 = Date.now();
    const stuck = await bench().run('let n = 0\nwhile true { n = n + 1 }');
    const elapsed = Date.now() - t0;
    await watchdog.terminate();
    expect(stuck.outcome).toEqual({
      ok: false,
      kind: 'timeout',
      message: 'TIMEOUT: the script ran too long and was stopped',
    });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5000);

    flag[0] = 0;
    expect((await bench().run('print("still alive")')).stdout).toEqual(['still alive']);
  }, 20_000);

  it('board.run and board.step are capped per call', async () => {
    const { stdout } = await lines(`
try { board.run(10001) } catch e { print(e) }
try { board.step(100001) } catch e { print(e) }
`);
    expect(stdout.every((l) => l.includes('BoardError: LIMIT'))).toBe(true);
  });
});

describe('NovaLang is vendored unmodified', () => {
  it('public/nova files match the hashes recorded in VERSION', () => {
    const version = read('public/nova/VERSION');
    const recorded = [...version.matchAll(/^sha256: ([0-9a-f]{64}) {2}(\S+)$/gm)];
    expect(recorded.map((m) => m[2])).toEqual([
      'novalang.py',
      'bootstrap.py',
      'novalang.nova',
      ...NOVA_TOOL_FILES.map((f) => `tools/${f}`),
    ]);
    for (const [, hash, file] of recorded) {
      expect(
        createHash('sha256')
          .update(read(`public/nova/${file}`))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(version).toMatch(/^commit: [0-9a-f]{40}$/m);
  });
});
