// Phase 7 acceptance: bridge contract v3, the clocked counter demo, viewport
// math and hosting config.
//   - board.display and board.clock exist on v3 requests and are refused on
//     v1/v2 ones; every v2 call still works.
//   - The 1 Hz counter demo counts by itself, and 10 times faster at 10 Hz.
//   - netlify.toml and vercel.json send the COOP/COEP headers Pyodide needs.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { benchCircuit, type Circuit } from '../../src/domain/circuit/circuit';
import { applyCommand, type Command } from '../../src/domain/circuit/commands';
import { SEGMENTS_FOR_DIGIT } from '../../src/domain/chips/sequential';
import { DECADE_COUNTER_CLOCKED } from '../../src/domain/demos/counter';
import { DEMOS } from '../../src/domain/demos';
import { Simulation } from '../../src/domain/sim/engine';
import { BRIDGE_COMMANDS, BRIDGE_OPS, BRIDGE_VERSION } from '../../src/protocol/bridge';
import { handleBridge } from '../../src/worker/bridge';
import { SimService } from '../../src/worker/sim-service';

const at =
  (v: number) =>
  (s: SimService, op: string, ...args: unknown[]) =>
    handleBridge(s, JSON.stringify({ v, id: 1, op, args })).response;
const v3 = at(3);

function build(base: Circuit, cmds: readonly Command[]): Circuit {
  return cmds.reduce<Circuit>((c, cmd) => {
    const r = applyCommand(c, cmd);
    if (!r.ok) throw new Error(`${JSON.stringify(cmd)}: ${r.error.message}`);
    return r.circuit;
  }, base);
}

function digitOn(sim: Simulation, id: string): number | null {
  const lit = Object.entries(sim.result.parts[id]!.segments!)
    .filter(([name, s]) => s.lit && name !== 'dp')
    .map(([name]) => name)
    .sort()
    .join('');
  const d = SEGMENTS_FOR_DIGIT.findIndex((s) => [...s].sort().join('') === lit);
  return d >= 0 ? d : null;
}

describe('bridge contract v3', () => {
  it('is version 3 with 13 commands and 16 calls in all', () => {
    expect(BRIDGE_VERSION).toBe(3);
    expect(BRIDGE_COMMANDS).toHaveLength(13);
    expect(BRIDGE_OPS).toHaveLength(16);
    expect(BRIDGE_COMMANDS).toEqual(expect.arrayContaining(['board.display', 'board.clock']));
  });

  it('board.display places a 7-segment display and maps its segments to pins', () => {
    const s = new SimService();
    v3(s, 'board.new', 'full');
    const r = v3(s, 'board.display', 'hole:e30');
    expect(r).toMatchObject({ ok: true, result: { id: 'DS1', type: 'display-7seg' } });
    const result = (r as { result: { segments: Record<string, string> } }).result;
    expect(result.segments).toEqual({
      a: 'pin:DS1:7',
      b: 'pin:DS1:6',
      c: 'pin:DS1:4',
      d: 'pin:DS1:2',
      e: 'pin:DS1:1',
      f: 'pin:DS1:9',
      g: 'pin:DS1:10',
      dp: 'pin:DS1:5',
    });
  });

  it('board.clock places a CLK lead that toggles at the given rate', () => {
    const s = new SimService();
    v3(s, 'board.new', 'half');
    expect(v3(s, 'board.clock', 'hole:a5', 10)).toEqual({
      v: 3,
      id: 1,
      ok: true,
      result: { id: 'CLK1', at: 'hole:a5', hz: 10, periodTicks: 100 },
    });
    const level = () =>
      (v3(s, 'sim.get', 'hole:b5') as { result: { level: unknown } }).result.level;
    expect(level()).toBe(1);
    v3(s, 'board.step', 50);
    expect(level()).toBe(0);
    v3(s, 'board.step', 50);
    expect(level()).toBe(1);
    // Default rate: 100 Hz.
    expect(v3(s, 'board.clock', 'hole:a10')).toMatchObject({
      result: { hz: 100, periodTicks: 10 },
    });
  });

  it.each([3, 0, -1, 1000, 0.01, '10'])('board.clock refuses hz = %s', (hz) => {
    const s = new SimService();
    v3(s, 'board.new', 'half');
    expect(v3(s, 'board.clock', 'hole:a5', hz)).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });

  it.each([1, 2])('refuses the new calls on a v%s request, keeps the old ones', (v) => {
    const s = new SimService();
    const call = at(v);
    expect(call(s, 'board.new', 'half')).toMatchObject({ ok: true });
    for (const op of ['board.display', 'board.clock']) {
      expect(call(s, op, 'hole:a5')).toMatchObject({
        ok: false,
        error: { code: 'BAD_ARGS', message: `${op} needs bridge contract v3` },
      });
    }
    expect(call(s, 'board.chip', '7400', 'hole:e10')).toMatchObject({ ok: true, v });
    expect(call(s, 'board.wire', 'pin:U1:14', 'rail:top+:1')).toMatchObject({ ok: true });
    expect(call(s, 'board.power', 'rail:top+:2')).toMatchObject({ ok: true });
    expect(call(s, 'board.step', 5)).toMatchObject({ ok: true, result: { ticks: 5 } });
  });
});

describe('acceptance: the clocked decade counter', () => {
  it('is a demo in the picker', () => {
    expect(DEMOS['decade-counter-clocked']).toBe(DECADE_COUNTER_CLOCKED);
    expect(readFileSync('index.html', 'utf8')).toContain('value="decade-counter-clocked"');
  });

  it('counts once a second at 1 Hz, and ten times a second at 10 Hz', () => {
    const c = build(benchCircuit(DECADE_COUNTER_CLOCKED.size), DECADE_COUNTER_CLOCKED.commands);
    expect(c.parts.some((p) => p.type === 'switch-spst')).toBe(false);
    const clk = c.supplies.find((s) => s.kind === 'clock')!;
    expect(clk.periodTicks).toBe(1000);
    const sim = new Simulation(c);
    const digits: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      sim.step(1000);
      digits.push(digitOn(sim, 'DS1'));
    }
    // CLK starts high at power-up (not an edge): it rises at 1 s, 2 s, 3 s …
    expect(digits).toEqual([0, 1, 2, 3]);

    sim.load(build(c, [{ op: 'setPeriod', id: clk.id, periodTicks: 100 }]));
    const fast: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      sim.step(100);
      fast.push(digitOn(sim, 'DS1'));
    }
    expect(fast).toEqual([4, 5, 6, 7]); // one count per 100 ms now
    expect(sim.result.warnings).toEqual([]);
  });
});

describe('hosting config', () => {
  const COOP = ['Cross-Origin-Opener-Policy', 'same-origin'];
  const COEP = ['Cross-Origin-Embedder-Policy', 'require-corp'];

  it('netlify.toml is valid TOML that builds dist and sends COOP/COEP on every path', async () => {
    const { parse } = await import('smol-toml');
    const toml = parse(readFileSync('netlify.toml', 'utf8')) as {
      build: { command: string; publish: string };
      headers: { for: string; values: Record<string, string> }[];
    };
    expect(toml.build).toMatchObject({ command: 'npm run build', publish: 'dist' });
    const all = toml.headers.find((h) => h.for === '/*')!;
    expect(all.values[COOP[0]!]).toBe(COOP[1]);
    expect(all.values[COEP[0]!]).toBe(COEP[1]);
  });

  it('vercel.json sends the same headers', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      outputDirectory: string;
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    expect(v.outputDirectory).toBe('dist');
    const all = v.headers.find((h) => h.source === '/(.*)')!;
    expect(all.headers).toEqual(
      expect.arrayContaining([
        { key: COOP[0], value: COOP[1] },
        { key: COEP[0], value: COEP[1] },
      ]),
    );
  });
});
