// Phase 4.5 acceptance: NovaLang scripts drive the board through the bridge.
//   1. public/nova/examples/half_adder.nova builds the half adder from scratch.
//   2. public/nova/examples/test_vectors.nova runs its four states with
//      board.set + sim.get and prints PASS.
// Runs the real vendored NovaLang under Pyodide in Node, the real host.py, the
// real bridge dispatcher and the real SimService.

import { beforeAll, describe, expect, it } from 'vitest';
import { bench, novaRuntime, read } from '../support/nova-node';

const HALF_ADDER = read('public/nova/examples/half_adder.nova');
const TEST_VECTORS = read('public/nova/examples/test_vectors.nova');

beforeAll(async () => {
  await novaRuntime();
}, 60_000);

describe('acceptance: half_adder.nova builds the half adder from scratch', () => {
  it('builds every part, wires it, and leaves no warnings', async () => {
    const b = bench();
    // Junk on the board first: board.new must start over.
    b.service.handle({
      v: 1,
      id: 1,
      kind: 'command',
      cmd: { op: 'place', type: 'led-red', at: 'hole:a1' },
    });

    const { outcome, stdout, stderr } = await b.run(HALF_ADDER);
    expect(outcome).toEqual({ ok: true });
    expect(stderr).toEqual([]);
    expect(stdout).toEqual(['half adder built: SW1 = A, SW2 = B, D1 = sum, D2 = carry']);

    const { circuit, result } = b.service.state;
    const count = (type: string) => circuit.parts.filter((p) => p.type === type).length;
    expect([
      count('switch-spdt'),
      count('chip74hc00'),
      count('resistor'),
      count('led-red'),
    ]).toEqual([2, 1, 2, 2]);
    expect(circuit.parts.map((p) => p.id)).toEqual(['SW1', 'SW2', 'U1', 'D1', 'R1', 'D2', 'R2']);
    expect(circuit.supplies).toHaveLength(4);
    expect(circuit.wires.length).toBe(16);
    expect(result.warnings).toEqual([]);
    // The UI saw the board being built, one edit at a time.
    expect(b.pushes.filter((m) => m.kind === 'circuit').length).toBe(1 + 4 + 7 + 16); // board.new + each edit
  });
});

describe('acceptance: test_vectors.nova', () => {
  it('runs the four states with board.set and sim.get and prints PASS', async () => {
    const b = bench();
    expect((await b.run(HALF_ADDER)).outcome).toEqual({ ok: true });
    const { outcome, stdout } = await b.run(TEST_VECTORS);
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual([
      'A=0 B=0 -> sum=false carry=false  ok',
      'A=0 B=1 -> sum=true carry=false  ok',
      'A=1 B=0 -> sum=true carry=false  ok',
      'A=1 B=1 -> sum=false carry=true  ok',
      'PASS',
    ]);
    expect(b.service.state.time.ticks).toBe(10 + 4 * 10);
  });

  it('really tests: a sabotaged half adder FAILs', async () => {
    const b = bench();
    await b.run(HALF_ADDER);
    // Pull W10, the wire that feeds n1 into gate 2 (2B): its output goes unknown.
    const w = b.service.state.circuit.wires.find((x) => x.id === 'W10')!;
    b.service.handle({ v: 1, id: 1, kind: 'command', cmd: { op: 'remove', id: w.id } });
    const { stdout } = await b.run(TEST_VECTORS);
    expect(stdout.at(-1)).toMatch(/^FAIL: [1-4] of 4 vectors wrong$/);
    expect(stdout.some((l) => l.includes('MISMATCH'))).toBe(true);
  });

  it('says what to do on an empty board', async () => {
    const { outcome, stdout } = await bench().run('board.new("half")\n' + TEST_VECTORS);
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual(['FAIL: no half adder on the board - run half_adder.nova first']);
  });
});

describe('the bridge contract, end to end from NovaLang', () => {
  it('every command and query works and returns plain data', async () => {
    const { outcome, stdout } = await bench().run(`
let info = board.new("half")
print(info["size"], info["rows"], info["splitRails"])
print(board.power("rail:top+:1")["volts"], board.ground("rail:top-:1")["volts"])
let sw = board.switch("hole:a3")
print(sw["id"], sw["type"], sw["pins"]["com"], sw["holes"]["com"])
let u = board.chip("74HC04", "hole:e10")
print(u["id"], u["type"], u["holes"]["1"], u["holes"]["14"])
let w = board.wire(u["pins"]["14"], "rail:top+:2")
print(w["id"], w["from"], w["to"])
let d = board.led("hole:i20", "hole:i21")
let r = board.resistor(1000, "rail:top+:20", d["pins"]["anode"])
print(r["id"], r["type"], r["holes"]["2"])
board.wire(d["pins"]["cathode"], "rail:top-:21")
print(board.set(sw["id"], 1)["position"])
print(board.step(3)["ticks"], board.run(2.5)["ms"], sim.time()["ticks"])
let g = sim.get("rail:top+:9")
print(g["level"], g["volts"])
let led = sim.get(d["id"])
print(led["type"], led["state"]["lit"], led["state"]["milliamps"])
let snap = sim.snapshot()
print(len(snap["parts"]), len(snap["wires"]), snap["time"]["ticks"])
`);
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual([
      'half 30 false',
      '5 0',
      'SW1 switch-spdt pin:SW1:com hole:a4',
      'U1 chip74hc04 hole:e10 hole:f10',
      'W1 hole:g10 rail:top+:2',
      'R1 resistor-1k hole:h20',
      '1',
      '3 6 6',
      '1 5',
      'led-red true 2.955', // 3 V / (1 kΩ + 15 Ω LED + 0.2 Ω supplies)
      '4 2 6',
    ]);
  });

  it('refusals are catchable errors that start with BoardError and the code', async () => {
    const cases: Array<[string, string]> = [
      ['occupied', 'board.led("hole:e10", "hole:a1")'],
      ['terminal', 'board.wire("e15", "hole:a1")'],
      ['placement', 'board.chip("7400", "hole:a20")'],
      ['type', 'board.chip("7499", "hole:e20")'],
      ['part', 'board.set("SW9", 1)'],
      ['args', 'board.run()'],
      ['ohms', 'board.resistor(47, "hole:a1", "hole:a5")'],
      ['limit', 'board.step(100001)'],
    ];
    const script = [
      'board.new("half")',
      'board.chip("7400", "hole:e10")',
      ...cases.map(
        ([name, call]) =>
          `try {\n    ${call}\n    print("${name} did not fail")\n} catch e {\n    print("${name}", e)\n}`,
      ),
    ].join('\n');
    const { outcome, stdout } = await bench().run(script);
    expect(outcome).toEqual({ ok: true });
    const codes = stdout.map((l) => /BoardError: ([A-Z_]+):/.exec(l)?.[1]);
    expect(codes).toEqual([
      'OCCUPIED',
      'BAD_TERMINAL',
      'BAD_PLACEMENT',
      'UNKNOWN_TYPE',
      'UNKNOWN_PART',
      'BAD_ARGS',
      'BAD_ARGS',
      'LIMIT',
    ]);
    expect(stdout[0]).toBe(
      'occupied PythonError: BoardError: OCCUPIED: hole:e10 already holds pin:U1:1',
    );
  });

  it('commands are not transactional: work before an error stays done', async () => {
    const b = bench();
    const { outcome } = await b.run(
      'board.new("half")\nboard.led("hole:a1", "hole:a2")\nboard.led("hole:a1", "hole:a3")',
    );
    expect(outcome).toMatchObject({
      ok: false,
      kind: 'error',
      message: expect.stringContaining('OCCUPIED'),
    });
    expect(b.service.state.circuit.parts.map((p) => p.id)).toEqual(['D1']);
  });
});

describe('docs/NOVALANG_BRIDGE.md examples run as documented', () => {
  const blocks = [...read('docs/NOVALANG_BRIDGE.md').matchAll(/```nova\n([\s\S]*?)```/g)].map(
    (m) => m[1]!,
  );

  it('the error example prints the documented message', async () => {
    const { stdout } = await bench().run('board.new("half")\n' + blocks[0]!);
    expect(stdout).toEqual([
      'PythonError: BoardError: BAD_PLACEMENT: 74HC00 quad NAND pin 1 must be in column e, got hole:a10',
    ]);
  });

  it('the minimal script prints the documented current', async () => {
    const { outcome, stdout } = await bench().run(blocks[1]!);
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual(['8.691']);
  });
});
