// Phase 6 acceptance: memory, displays and more chips.
//   - The 74HC74 updates only on a rising CLK edge: not on a falling edge, not
//     while CLK stays high.
//   - A switch-clocked flip-flop changes on switch-on, not switch-off.
//   - A decade counter of 74HC74s drives a 7-segment display through 0–9.
//   - (Logic analyzer: see the trace tests at the end.)

import { describe, expect, it } from 'vitest';
import { benchCircuit, type Circuit } from '../../src/domain/circuit/circuit';
import { applyCommand, type Command } from '../../src/domain/circuit/commands';
import { SEGMENTS_FOR_DIGIT } from '../../src/domain/chips/sequential';
import { DECADE_COUNTER, FLIP_FLOP } from '../../src/domain/demos/counter';
import { Simulation } from '../../src/domain/sim/engine';

function build(base: Circuit, cmds: readonly Command[]): Circuit {
  return cmds.reduce<Circuit>((c, cmd) => {
    const r = applyCommand(c, cmd);
    if (!r.ok) throw new Error(`${JSON.stringify(cmd)}: ${r.error.message}`);
    return r.circuit;
  }, base);
}

/** A live board: edit it, step it, read levels. */
function rig(base: Circuit, cmds: readonly Command[] = []) {
  let c = build(base, cmds);
  const sim = new Simulation(c);
  const level = (key: string) => sim.levelOf(key);
  return {
    sim,
    level,
    get circuit() {
      return c;
    },
    edit(...more: Command[]) {
      c = build(c, more);
      sim.load(c);
    },
    set(id: string, value: number) {
      this.edit({ op: 'set', id, value });
    },
  };
}

/**
 * Powered 74HC74 at e10 with flip-flop 1's D and CLK on SPDT switches (a firm
 * 0 or 1, no pull resistors): SW1 = D, SW2 = CLK. PRE' and CLR' high.
 * Flip-flop 2's inputs are tied so nothing floats.
 */
const DFF: Command[] = [
  { op: 'place', type: 'chip74hc74', at: 'hole:e10' },
  { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
  { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
  { op: 'wire', from: 'pin:U1:1', to: 'rail:bottom+:3' },
  { op: 'wire', from: 'pin:U1:4', to: 'rail:bottom+:4' },
  { op: 'wire', from: 'pin:U1:10', to: 'rail:top+:3' },
  { op: 'wire', from: 'pin:U1:13', to: 'rail:top+:4' },
  { op: 'wire', from: 'pin:U1:11', to: 'rail:top-:2' },
  { op: 'wire', from: 'pin:U1:12', to: 'rail:top-:3' },
  // SPDT: a (position 0) to ground, b (position 1) to +5 V.
  { op: 'place', type: 'switch-spdt', at: 'hole:a3' }, // SW1: a3 a, a4 com, a5 b
  { op: 'wire', from: 'hole:b3', to: 'rail:bottom-:5' },
  { op: 'wire', from: 'hole:b5', to: 'rail:bottom+:6' },
  { op: 'wire', from: 'hole:c4', to: 'pin:U1:2' }, // D
  { op: 'place', type: 'switch-spdt', at: 'hole:a20' }, // SW2: a20 a, a21 com, a22 b
  { op: 'wire', from: 'hole:b20', to: 'rail:bottom-:20' },
  { op: 'wire', from: 'hole:b22', to: 'rail:bottom+:21' },
  { op: 'wire', from: 'hole:c21', to: 'pin:U1:3' }, // CLK
];

describe('acceptance: the 74HC74 updates only on a rising clock edge', () => {
  it('rising edge latches D; falling edge and steady HIGH do not', () => {
    const r = rig(benchCircuit(), DFF);
    r.sim.step(5);
    const q = () => r.level('pin:U1:5');
    const qn = () => r.level('pin:U1:6');
    expect([q(), qn()]).toEqual([0, 1]); // powers up cleared

    r.set('SW1', 1); // D = 1, CLK still low
    r.sim.step(5);
    expect(q()).toBe(0); // D alone changes nothing

    r.set('SW2', 1); // CLK rises
    expect(q()).toBe(0); // not in the same tick...
    r.sim.step(1);
    expect([q(), qn()]).toEqual([1, 0]); // ...one tick later

    r.set('SW1', 0); // D = 0 while CLK stays HIGH
    r.sim.step(20);
    expect(q()).toBe(1); // a steady high clock does not sample D

    r.set('SW2', 0); // CLK falls
    r.sim.step(20);
    expect(q()).toBe(1); // a falling edge does not sample D either

    r.set('SW2', 1); // the next rising edge does
    r.sim.step(1);
    expect([q(), qn()]).toEqual([0, 1]);
  });

  it("PRE' and CLR' act at once, without a clock, and win over it", () => {
    const r = rig(
      benchCircuit(),
      DFF.filter((c) => !(c.op === 'wire' && (c.from === 'pin:U1:1' || c.from === 'pin:U1:4'))),
    );
    // PRE' and CLR' on switches: SW3 → CLR' (pin 1), SW4 → PRE' (pin 4). Position 1 = high = inactive.
    r.edit(
      { op: 'place', type: 'switch-spdt', at: 'hole:f24' }, // SW3: f24 a, f25 com, f26 b
      { op: 'wire', from: 'hole:g24', to: 'rail:top-:20' },
      { op: 'wire', from: 'hole:g26', to: 'rail:top+:21' },
      { op: 'wire', from: 'hole:h25', to: 'pin:U1:1' },
      { op: 'place', type: 'switch-spdt', at: 'hole:f28' }, // SW4
      { op: 'wire', from: 'hole:g28', to: 'rail:top-:24' },
      { op: 'wire', from: 'hole:g30', to: 'rail:top+:25' },
      { op: 'wire', from: 'hole:h29', to: 'pin:U1:4' },
      { op: 'set', id: 'SW3', value: 1 },
      { op: 'set', id: 'SW4', value: 1 },
    );
    r.sim.step(5);
    const q = () => r.level('pin:U1:5');
    r.set('SW4', 0); // PRE' low
    r.sim.step(1);
    expect(q()).toBe(1);
    r.set('SW4', 1);
    r.set('SW3', 0); // CLR' low
    r.sim.step(1);
    expect(q()).toBe(0);
    r.set('SW1', 1);
    r.set('SW2', 1); // a rising edge while CLR' is held low
    r.sim.step(5);
    expect(q()).toBe(0); // clear wins
    r.set('SW4', 0); // both low: both outputs high
    r.sim.step(1);
    expect([q(), r.level('pin:U1:6')]).toEqual([1, 1]);
  });
});

describe('acceptance: a switch as the clock (flip-flop demo)', () => {
  it('switching on toggles the output; switching off does not', () => {
    const r = rig(benchCircuit(FLIP_FLOP.size), FLIP_FLOP.commands);
    r.sim.step(10);
    const lit = () => r.sim.result.parts['D1']!.lit;
    const seen: string[] = [`start:${lit()}`];
    for (let i = 0; i < 3; i++) {
      for (const v of [1, 0]) {
        r.set('SW1', v);
        r.sim.step(10);
        seen.push(`${v ? 'on' : 'off'}:${lit()}`);
      }
    }
    expect(seen).toEqual([
      'start:false',
      'on:true',
      'off:true',
      'on:false',
      'off:false',
      'on:true',
      'off:true',
    ]);
    expect(r.sim.result.warnings).toEqual([]);
  });
});

/** The digit a display shows, from its lit segments (null for blank or not a digit). */
function digitOn(sim: Simulation, id: string): number | null {
  const segs = sim.result.parts[id]!.segments!;
  const lit = Object.entries(segs)
    .filter(([name, s]) => s.lit && name !== 'dp')
    .map(([name]) => name)
    .sort()
    .join('');
  const d = SEGMENTS_FOR_DIGIT.findIndex((s) => [...s].sort().join('') === lit);
  return d >= 0 ? d : null;
}

describe('acceptance: a 74HC74 decade counter counts 0–9 on a 7-segment display', () => {
  it('counts one per manual clock pulse and rolls over from 9 to 0', () => {
    const r = rig(benchCircuit(DECADE_COUNTER.size), DECADE_COUNTER.commands);
    r.sim.step(20);
    const digits = [digitOn(r.sim, 'DS1')];
    for (let i = 0; i < 12; i++) {
      r.set('SW1', 1);
      r.sim.step(20);
      r.set('SW1', 0);
      r.sim.step(20);
      digits.push(digitOn(r.sim, 'DS1'));
    }
    expect(digits).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(r.sim.result.warnings).toEqual([]);
    // Each lit segment runs at a healthy ~7.6 mA through its 330 Ω.
    expect(r.sim.result.parts['DS1']!.segments!['b']!.milliamps).toBeCloseTo(7.6, 0);
  });

  it('it counts on the switch-on edge only', () => {
    const r = rig(benchCircuit(DECADE_COUNTER.size), DECADE_COUNTER.commands);
    r.sim.step(20);
    r.set('SW1', 1);
    r.sim.step(20);
    expect(digitOn(r.sim, 'DS1')).toBe(1);
    r.set('SW1', 0);
    r.sim.step(20);
    expect(digitOn(r.sim, 'DS1')).toBe(1);
  });
});

describe('74HC4511 decoder', () => {
  /** Powered 4511 at e10 with A..D, LT', BL', LE each on its own rail-tied wire, set per case. */
  function decode(code: number, lt = 1, bl = 1): string {
    const tie = (n: number, high: boolean | number, k: number): Command => ({
      op: 'wire',
      from: `pin:U1:${n}`,
      to: n > 8 ? `rail:top${high ? '+' : '-'}:${k}` : `rail:bottom${high ? '+' : '-'}:${k}`,
    });
    const bits = [7, 1, 2, 6].map((n, i) => tie(n, (code >> i) & 1, 2 + i));
    const r = rig(benchCircuit(), [
      { op: 'place', type: 'chip74hc4511', at: 'hole:e10' },
      tie(16, true, 2),
      tie(8, false, 10),
      ...bits,
      tie(3, lt, 7),
      tie(4, bl, 8),
      tie(5, false, 9),
    ]);
    r.sim.step(3);
    const outs = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };
    return Object.entries(outs)
      .filter(([, n]) => r.level(`pin:U1:${n}`) === 1)
      .map(([s]) => s)
      .join('');
  }

  it('decodes 0–9 like the datasheet and blanks 10–15', () => {
    const got = Array.from({ length: 16 }, (_, n) => decode(n));
    expect(got.slice(0, 10)).toEqual(SEGMENTS_FOR_DIGIT.map((s) => [...s].join('')));
    expect(got.slice(10)).toEqual(['', '', '', '', '', '']);
  });

  it("LT' lights everything; BL' blanks", () => {
    expect(decode(3, 0)).toBe('abcdefg');
    expect(decode(3, 1, 0)).toBe('');
  });
});

describe('74HC32 and 74HC86 follow the 74HC00 pinout', () => {
  it.each([
    ['chip74hc32', [0, 1, 1, 1]],
    ['chip74hc86', [0, 1, 1, 0]],
  ] as const)('%s gate 1 truth table on the board', (type, expected) => {
    const got = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ].map(([a, b]) => {
      const r = rig(benchCircuit(), [
        { op: 'place', type, at: 'hole:e10' },
        { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
        { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
        { op: 'wire', from: 'pin:U1:1', to: a ? 'rail:bottom+:3' : 'rail:bottom-:3' },
        { op: 'wire', from: 'pin:U1:2', to: b ? 'rail:bottom+:4' : 'rail:bottom-:4' },
      ]);
      r.sim.step(3);
      return r.level('pin:U1:3');
    });
    expect(got).toEqual(expected);
  });
});

describe('7-segment display', () => {
  it('a segment through 330 Ω lights; a segment straight off the rail burns out', () => {
    const r = rig(benchCircuit(), [
      { op: 'place', type: 'display-7seg', at: 'hole:e10' },
      { op: 'wire', from: 'pin:DS1:3', to: 'rail:bottom-:2' }, // COM
      { op: 'placeLeads', type: 'resistor', pins: { '1': 'rail:top+:9', '2': 'pin:DS1:7' } }, // a
      { op: 'wire', from: 'pin:DS1:6', to: 'rail:top+:15' }, // b, no resistor
    ]);
    const segs = r.sim.result.parts['DS1']!.segments!;
    expect(segs['a']).toMatchObject({ lit: true, burnt: false });
    expect(segs['a']!.milliamps).toBeCloseTo(8.7, 0);
    expect(segs['b']).toMatchObject({ lit: false, burnt: true });
    expect(segs['c']).toMatchObject({ lit: false, burnt: false });
    expect(r.sim.result.warnings.map((w) => w.code)).toEqual(['LED_BURNT']);
    expect(r.sim.result.warnings[0]!.message).toMatch(
      /^DS1 segment b burned out: current limit exceeded/,
    );
  });

  it('both COM pins are the same net', () => {
    const r = rig(benchCircuit(), [{ op: 'place', type: 'display-7seg', at: 'hole:e10' }]);
    const net = (k: string) => r.sim.result.nets.find((n) => n.terminals.includes(k))!.id;
    expect(net('pin:DS1:3')).toBe(net('pin:DS1:8'));
    expect(net('pin:DS1:3')).not.toBe(net('pin:DS1:1'));
  });
});

describe('clock lead', () => {
  it('is a 0/5 V square wave, high for the first half of each period', () => {
    const r = rig(benchCircuit(), [{ op: 'clock', at: 'hole:a5', periodTicks: 10 }]);
    const wave: number[] = [];
    r.sim.step(20, () => wave.push(r.level('hole:e5') as number));
    expect(wave.join('')).toBe('11110000011111000001'); // ticks 1..20: toggles at 5, 10, 15, 20
  });

  it('periods are even numbers of ticks; setPeriod changes one in place', () => {
    const c = build(benchCircuit(), [{ op: 'clock', at: 'hole:a5' }]);
    expect(c.supplies.find((s) => s.id === 'CLK1')).toMatchObject({
      kind: 'clock',
      periodTicks: 10,
    });
    expect(applyCommand(c, { op: 'setPeriod', id: 'CLK1', periodTicks: 7 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    const r = applyCommand(c, { op: 'setPeriod', id: 'CLK1', periodTicks: 1000 });
    expect(r.ok && r.circuit.supplies.find((s) => s.id === 'CLK1')!.periodTicks).toBe(1000);
    expect(applyCommand(c, { op: 'setPeriod', id: 'VCC1', periodTicks: 10 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });
});

describe('acceptance: the logic analyzer shows a clock as a square wave', () => {
  async function analyzerRig() {
    const { connectInProcess } = await import('../support/in-process-host');
    const c = await connectInProcess({ preset: 'bench' });
    let frame: import('../../src/protocol/sim-protocol').SimFrame | null = null;
    c.host.subscribeFrames((f) => (frame = f));
    const apply = async (...cmds: Command[]) => {
      for (const cmd of cmds) {
        const r = await c.host.apply(cmd);
        if (!r.ok) throw new Error(r.error.message);
      }
    };
    return { ...c, apply, frame: () => frame! };
  }
  const row = (levels: readonly unknown[]) => levels.map(String).join('');

  it('records the last 50 ticks of a probed clock wire', async () => {
    const a = await analyzerRig();
    try {
      await a.apply(
        { op: 'clock', at: 'hole:a5', periodTicks: 10 }, // CLK1: 100 Hz
        { op: 'wire', from: 'hole:b5', to: 'hole:b20' }, // W1 carries it
      );
      await a.host.setProbes(['hole:b5']);
      await a.host.step(30);
      let t = a.frame().trace;
      expect(t.probes).toEqual(['hole:b5']);
      expect(t.ticks).toEqual(Array.from({ length: 31 }, (_, i) => i)); // tick 0 (at probe time) to 30
      expect(row(t.levels[0]!)).toBe('1111100000111110000011111000001');

      await a.host.step(100);
      t = a.frame().trace;
      expect(t.ticks).toHaveLength(50); // only the last 50
      expect(t.ticks.at(-1)).toBe(130);
      // A square wave: runs of exactly 5 highs and 5 lows.
      const runs = row(t.levels[0]!).match(/0+|1+/g)!;
      expect(runs.slice(1, -1).every((r) => r.length === 5)).toBe(true);
      expect(new Set(row(t.levels[0]!))).toEqual(new Set(['0', '1']));
    } finally {
      a.close();
    }
  });

  it('up to 4 probes, each sampled every tick; edges line up with the flip-flop', async () => {
    const a = await analyzerRig();
    try {
      // A 74HC74 toggling on a 20-tick clock: Q is a square wave at half the frequency.
      await a.apply(
        ...DFF.filter(
          (cmd) =>
            !(cmd.op === 'place' && cmd.type === 'switch-spdt') &&
            !(cmd.op === 'wire' && /hole:[bc](3|4|5|20|21|22)$/.test(cmd.from)),
        ),
        { op: 'wire', from: 'pin:U1:6', to: 'pin:U1:2' }, // D = Q'
        { op: 'clock', at: 'hole:a30', periodTicks: 20 },
        { op: 'wire', from: 'hole:b30', to: 'pin:U1:3' },
      );
      await a.host.setProbes(['hole:c30', 'pin:U1:5']);
      await a.host.step(49);
      const [clk, out] = a.frame().trace.levels.map(row);
      // Ticks 0–49 of a 20-tick clock: 10 high, 10 low, …
      expect(clk).toBe(('1'.repeat(10) + '0'.repeat(10)).repeat(3).slice(0, 50));
      // Q starts cleared and toggles one tick after each rising edge (ticks 20 and 40).
      // At tick 0 the just-placed chip is not driving yet (Z): outputs settle after one tick.
      expect(out).toBe('Z' + '0'.repeat(20) + '1'.repeat(20) + '0'.repeat(9));
      expect(await a.host.setProbes(['a', 'b', 'c', 'd', 'e'])).toMatchObject({ ok: false });
    } finally {
      a.close();
    }
  });

  it('the editor probes a wire by clicking it, end or middle; a removed wire drops off', async () => {
    const { connectInProcess } = await import('../support/in-process-host');
    const { Editor } = await import('../../src/ui/editor/editor');
    const c = await connectInProcess({ preset: 'bench' });
    try {
      const editor = new Editor(c.host);
      for (const cmd of [
        { op: 'clock', at: 'hole:a5' },
        { op: 'wire', from: 'hole:b5', to: 'hole:b20' },
        { op: 'wire', from: 'hole:c5', to: 'hole:c25' },
      ] as Command[]) {
        await c.host.apply(cmd);
      }
      editor.setTool({ kind: 'select' });
      await editor.pointerDown({ kind: 'hole', column: 'b', row: 5 }); // W1's end
      await editor.pointerDown(null, { x: 14, y: 12 }); // the middle of W2 (row 15, column c)
      expect(editor.probes).toEqual(['W1', 'W2']);
      await editor.pointerDown({ kind: 'hole', column: 'b', row: 20 }); // W1 again: off
      expect(editor.probes).toEqual(['W2']);
      await c.host.apply({ op: 'remove', id: 'W2' });
      expect(editor.probes).toEqual([]);
      // Clicking the clock lead selects it for the inspector.
      await editor.pointerDown({ kind: 'hole', column: 'a', row: 5 });
      expect(editor.selected).toBe('CLK1');
      await editor.setPeriod(100);
      expect(editor.current.supplies.find((s) => s.id === 'CLK1')!.periodTicks).toBe(100);
    } finally {
      c.close();
    }
  });
});

describe('clicking parts', () => {
  it('a long diagonal resistor does not swallow clicks on the display it crosses', async () => {
    const { partAtPoint } = await import('../../src/domain/circuit/circuit');
    const c = build(benchCircuit(DECADE_COUNTER.size), DECADE_COUNTER.commands);
    expect(partAtPoint(c, 53, 7)?.id).toBe('DS1'); // the display body
    // An isolated diagonal resistor: hit along its leads, not across its whole bounding box.
    const lone = build(benchCircuit(), [
      { op: 'placeLeads', type: 'resistor', pins: { '1': 'hole:a1', '2': 'hole:j21' } },
    ]);
    expect(partAtPoint(lone, 10, 8.5)?.id).toBe('R1'); // on the line from (0, 14) to (20, 3)
    expect(partAtPoint(lone, 2, 4)).toBeUndefined(); // inside the box, far from the line
  });
});
