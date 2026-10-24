// Phase 3 acceptance: 74xx chips evaluate logic with a propagation delay on a
// 1 kHz tick, board.run/board.step move time, and a half adder built from one
// 74HC00, two switches and two LEDs plays out its truth table.

import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../src/domain/circuit/commands';
import { HALF_ADDER } from '../../src/domain/demos/half-adder';
import type { PortLike, SimFrame, SimMessage } from '../../src/protocol/sim-protocol';
import { SimService, serveSim } from '../../src/worker/sim-service';
import { connectInProcess, type Connected } from '../support/in-process-host';

const open: Connected[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

async function bench(...cmds: readonly Command[]) {
  const c = await connectInProcess({ preset: 'bench' });
  open.push(c);
  let frame: SimFrame | null = null;
  c.host.subscribeFrames((f) => (frame = f));
  const apply = async (...more: readonly Command[]) => {
    for (const cmd of more) {
      const r = await c.host.apply(cmd);
      if (!r.ok) throw new Error(`${cmd.op}: ${r.error.code} ${r.error.message}`);
    }
  };
  await apply(...cmds);
  const level = (key: string) => frame!.nets.find((n) => n.terminals.includes(key))!.level;
  return { host: c.host, apply, frame: () => frame!, level };
}

/** A powered 74HC00 at e10 with 1A tied high and 1B on a switch (closed = high, open = pulled low). */
const NAND_RIG: readonly Command[] = [
  { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
  { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
  { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
  { op: 'wire', from: 'pin:U1:1', to: 'rail:bottom+:3' },
  { op: 'place', type: 'switch-spst', at: 'hole:a3' }, // a3 (+5 V row) – a5 (1B row)
  { op: 'wire', from: 'hole:b3', to: 'rail:bottom+:4' },
  { op: 'place', type: 'resistor', at: 'hole:c1' }, // pull-down: c1 (ground row) – c5
  { op: 'wire', from: 'hole:b1', to: 'rail:bottom-:3' },
  { op: 'wire', from: 'hole:d5', to: 'pin:U1:2' },
];

describe('acceptance: gate propagation delay', () => {
  it('the output does not change in the same tick as the input', async () => {
    const b = await bench(...NAND_RIG);
    await b.host.step(5);
    expect(b.level('pin:U1:2')).toBe(0);
    expect(b.level('pin:U1:3')).toBe(1); // NAND(1, 0)
    const t0 = b.frame().time.ticks;

    await b.apply({ op: 'set', id: 'SW1', value: 1 }); // 1B goes high now...
    expect(b.frame().time.ticks).toBe(t0); // ...time has not moved...
    expect(b.level('pin:U1:2')).toBe(1);
    expect(b.level('pin:U1:3')).toBe(1); // ...and the output has not changed yet
    expect(b.frame().settled).toBe(false); // but a change is on its way

    const r = await b.host.step(1);
    expect(r).toEqual({ ok: true, time: { ticks: t0 + 1, ms: t0 + 1 } });
    expect(b.level('pin:U1:3')).toBe(0); // one tick later: NAND(1, 1)
    expect(b.frame().settled).toBe(true);
  });

  it('in the half adder, each output changes one tick per gate on its path', async () => {
    const b = await bench(...HALF_ADDER.commands);
    await b.host.run(10);
    const lit = () => [b.frame().parts['D1']!.lit, b.frame().parts['D2']!.lit];
    expect(lit()).toEqual([false, false]);

    // A rises with B low: n1 stays 1, A → gate 2 → gate 4 is two gates deep.
    await b.apply({ op: 'set', id: 'SW1', value: 1 });
    const timeline = [lit()];
    for (let i = 0; i < 4; i++) {
      await b.host.step(1);
      timeline.push(lit());
    }
    expect(timeline).toEqual([
      [false, false], // t0: input changed, nothing else yet
      [false, false], // t0+1: n2 falls
      [true, false], // t0+2: sum rises
      [true, false],
      [true, false],
    ]);

    // B rises with A high: carry is n1 inverted (one gate); sum must wait for n1
    // to reach gates 2 and 3 and then gate 4 — three gates deep.
    await b.apply({ op: 'set', id: 'SW2', value: 1 });
    await b.host.step(1);
    expect(lit()).toEqual([true, true]); // t0+1: carry on, sum still showing the old 1
    await b.host.step(1);
    expect(lit()).toEqual([true, true]); // t0+2
    await b.host.step(1);
    expect(lit()).toEqual([false, true]); // t0+3: sum falls
  });
});

describe('acceptance: half-adder truth table', () => {
  it('00 → 0, 01 → 1, 10 → 1, 11 → 0 carry 1', async () => {
    const b = await bench(...HALF_ADDER.commands);
    const rows: string[] = [];
    for (const [a, bIn] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      await b.apply({ op: 'set', id: 'SW1', value: a }, { op: 'set', id: 'SW2', value: bIn });
      await b.host.run(5);
      const f = b.frame();
      rows.push(`${a}${bIn} sum=${f.parts['D1']!.lit ? 1 : 0} carry=${f.parts['D2']!.lit ? 1 : 0}`);
      expect(f.settled).toBe(true);
      expect(f.warnings).toEqual([]);
    }
    expect(rows).toEqual([
      '00 sum=0 carry=0',
      '01 sum=1 carry=0',
      '10 sum=1 carry=0',
      '11 sum=0 carry=1',
    ]);
  });
});

describe('board.step / board.run over the protocol', () => {
  it('step advances exact ticks; run rounds ms up to whole ticks', async () => {
    const b = await bench();
    expect(await b.host.step(3)).toEqual({ ok: true, time: { ticks: 3, ms: 3 } });
    expect(await b.host.run(2.5)).toEqual({ ok: true, time: { ticks: 6, ms: 6 } });
    expect(b.frame().time).toEqual({ ticks: 6, ms: 6 });
  });

  it('enforces the bridge caps and argument rules', async () => {
    const b = await bench();
    expect(await b.host.step(100_001)).toMatchObject({ ok: false, error: { code: 'LIMIT' } });
    expect(await b.host.run(10_001)).toMatchObject({ ok: false, error: { code: 'LIMIT' } });
    expect(await b.host.step(0)).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } });
    expect(await b.host.step(1.5)).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } });
    expect(await b.host.run(-1)).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } });
    expect(await b.host.step(100_000)).toEqual({ ok: true, time: { ticks: 100_000, ms: 100_000 } });
  });

  it('reset starts time over', async () => {
    const b = await bench();
    await b.host.step(10);
    await b.host.reset();
    expect(b.frame().time).toEqual({ ticks: 0, ms: 0 });
  });
});

describe('the real-time 1 kHz clock', () => {
  function fakeClock() {
    let now = 0;
    let tick: (() => void) | null = null;
    return {
      clock: { now: () => now, every: (_ms: number, fn: () => void) => void (tick = fn) },
      advance(ms: number) {
        now += ms;
        tick!();
      },
    };
  }

  function served() {
    const sent: SimMessage[] = [];
    const port: PortLike = { postMessage: (m) => sent.push(m as SimMessage), onmessage: null };
    const fake = fakeClock();
    serveSim(port, new SimService(), fake.clock);
    const send = (req: object) =>
      port.onmessage!({ data: { v: 1, id: 1, ...req } } as MessageEvent);
    const lastTime = () => {
      for (let i = sent.length - 1; i >= 0; i--) {
        const m = sent[i]!;
        if (m.kind === 'frame') return m.frame.time.ticks;
        if (m.kind === 'time') return m.time.ticks;
      }
      return -1;
    };
    return { fake, send, lastTime };
  }

  it('advances one tick per millisecond while running, none while paused', () => {
    const s = served();
    s.send({ kind: 'hello', size: 'half', preset: 'bench' });
    s.fake.advance(50);
    expect(s.lastTime()).toBe(0); // paused by default
    s.send({ kind: 'clock', running: true });
    for (let i = 0; i < 25; i++) s.fake.advance(8); // 200 ms
    s.send({ kind: 'clock', running: false });
    expect(s.lastTime()).toBe(200);
    s.fake.advance(500);
    expect(s.lastTime()).toBe(200);
  });

  it('caps catch-up after a long stall instead of replaying it', () => {
    const s = served();
    s.send({ kind: 'hello', size: 'half', preset: 'bench' });
    s.send({ kind: 'clock', running: true });
    s.fake.advance(60_000);
    s.send({ kind: 'clock', running: false });
    expect(s.lastTime()).toBe(250);
  });
});
