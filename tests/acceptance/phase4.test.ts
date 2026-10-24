// Phase 4 acceptance: Stage-2 electrical. Resistors limit current, an LED
// across the rails with no resistor burns out with a current-limit warning,
// and opposing gate outputs wired together raise CONTENTION, unless a
// resistor sits between them.

import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../src/domain/circuit/commands';
import { HALF_ADDER } from '../../src/domain/demos/half-adder';
import type { SimFrame } from '../../src/protocol/sim-protocol';
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
  await c.host.step(5);
  const net = (key: string) => frame!.nets.find((n) => n.terminals.includes(key))!;
  const codes = () => frame!.warnings.map((w) => w.code);
  return { host: c.host, apply, frame: () => frame!, net, codes };
}

/**
 * A powered 74HC04 at e10. Inverter 1: 1A (pin 1) tied high, so 1Y (pin 2,
 * row 11) drives LOW. Inverter 2: 2A (pin 3) tied low, so 2Y (pin 4, row 13)
 * drives HIGH. The other four inverters' inputs are tied low so nothing floats.
 */
const TWO_OPPOSING_OUTPUTS: readonly Command[] = [
  { op: 'place', type: 'chip74hc04', at: 'hole:e10' },
  { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
  { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
  { op: 'wire', from: 'pin:U1:1', to: 'rail:bottom+:3' },
  { op: 'wire', from: 'pin:U1:3', to: 'rail:bottom-:3' },
  { op: 'wire', from: 'pin:U1:5', to: 'rail:bottom-:4' },
  { op: 'wire', from: 'pin:U1:9', to: 'rail:top-:2' },
  { op: 'wire', from: 'pin:U1:11', to: 'rail:top-:3' },
  { op: 'wire', from: 'pin:U1:13', to: 'rail:top-:4' },
];

describe('acceptance: drive-strength contention', () => {
  it('the rig is clean before the outputs are joined: one low, one high', async () => {
    const b = await bench(...TWO_OPPOSING_OUTPUTS);
    expect(b.net('pin:U1:2').level).toBe(0);
    expect(b.net('pin:U1:4').level).toBe(1);
    expect(b.frame().warnings).toEqual([]);
  });

  it('wiring a HIGH output straight to a LOW output raises CONTENTION', async () => {
    const b = await bench(...TWO_OPPOSING_OUTPUTS, {
      op: 'wire',
      from: 'pin:U1:2',
      to: 'pin:U1:4',
    });
    const w = b.frame().warnings.find((x) => x.code === 'CONTENTION');
    expect(w?.at).toEqual(['pin:U1:2', 'pin:U1:4']);
    expect(w?.message).toBe(
      'outputs fight over one net: U1 pin 2 (1Y) drives low, U1 pin 4 (2Y) drives high; 50.0 mA flows (74HC limit 25 mA per output)',
    );
    const fought = b.net('pin:U1:2');
    expect(fought.level).toBe('X'); // two 50 Ω outputs split the rail: 2.5 V
    expect(fought.volts).toBeCloseTo(2.5, 2);
  });

  it('the same two outputs joined through a 330 Ω resistor do not contend', async () => {
    const b = await bench(...TWO_OPPOSING_OUTPUTS, {
      op: 'placeLeads',
      type: 'resistor',
      pins: { '1': 'hole:c11', '2': 'hole:c13' }, // row 11 (1Y) to row 13 (2Y)
    });
    expect(b.codes()).not.toContain('CONTENTION');
    expect(b.frame().warnings).toEqual([]);
    // 5 V across 330 Ω + 2 × 50 Ω: about 11.6 mA, well under 25 mA.
    expect(b.frame().parts['R1']!.milliamps).toBeCloseTo(-11.6, 1);
    expect(b.net('pin:U1:2')).toMatchObject({ level: 0 });
    expect(b.net('pin:U1:4')).toMatchObject({ level: 1 });
    expect(b.net('pin:U1:2').volts).toBeCloseTo(0.58, 2);
  });

  it('an output against the supply rail is contention too', async () => {
    const b = await bench(...TWO_OPPOSING_OUTPUTS, {
      op: 'wire',
      from: 'pin:U1:4',
      to: 'rail:bottom-:5',
    });
    const w = b.frame().warnings.find((x) => x.code === 'CONTENTION')!;
    expect(w.message).toMatch(/U1 pin 4 \(2Y\) drives high, GND\d drives low/);
  });

  it('an output overloaded through a small resistor is OUTPUT_OVERLOAD, not contention', async () => {
    const b = await bench(...TWO_OPPOSING_OUTPUTS, {
      op: 'placeLeads',
      type: 'resistor-100',
      pins: { '1': 'hole:c13', '2': 'rail:bottom-:9' }, // 2Y (high) → 100 Ω → ground
    });
    expect(b.codes()).toEqual(['OUTPUT_OVERLOAD']);
    expect(b.frame().warnings[0]!.message).toBe(
      'U1 pin 4 (2Y) sources 33.3 mA, over the 74HC limit of 25 mA: add a series resistor',
    );
  });
});

/** LED with anode in row 20 and cathode in row 21; row 21 goes to ground. */
const LED_TO_GROUND: readonly Command[] = [
  { op: 'place', type: 'led-red', at: 'hole:a20' },
  { op: 'wire', from: 'hole:b21', to: 'rail:bottom-:2' },
];

describe('acceptance: resistors limit LED current', () => {
  it('+5 V → 330 Ω → LED → ground lights normally', async () => {
    const b = await bench(
      ...LED_TO_GROUND,
      { op: 'place', type: 'resistor', at: 'hole:c16' }, // c16–c20
      { op: 'wire', from: 'hole:b16', to: 'rail:bottom+:2' },
    );
    expect(b.frame().parts['D1']).toMatchObject({ lit: true, burnt: false });
    expect(b.frame().parts['D1']!.milliamps).toBeCloseTo(8.7, 0);
    expect(b.frame().parts['D1']!.brightness).toBeCloseTo(0.43, 1);
    expect(b.frame().warnings).toEqual([]);
  });

  it('without a resistor the LED exceeds its current limit and burns out', async () => {
    const b = await bench(...LED_TO_GROUND, { op: 'wire', from: 'hole:b20', to: 'rail:bottom+:2' });
    expect(b.frame().parts['D1']).toMatchObject({ lit: false, burnt: true, milliamps: 0 });
    const w = b.frame().warnings.find((x) => x.code === 'LED_BURNT')!;
    expect(w.message).toMatch(
      /^D1 burned out: current limit exceeded \(\d+ mA through it, rated 20 mA\)/,
    );
    expect(w.at).toEqual(['pin:D1:anode', 'pin:D1:cathode']);
    expect(b.codes()).toEqual(['LED_BURNT']);
  });

  it('a burnt LED stays dead after the circuit is fixed, until it is replaced', async () => {
    const b = await bench(...LED_TO_GROUND, { op: 'wire', from: 'hole:b20', to: 'rail:bottom+:2' });
    // Fix the circuit: swap the direct wire for a 330 Ω resistor.
    await b.apply(
      { op: 'remove', id: 'W2' },
      { op: 'place', type: 'resistor', at: 'hole:c16' },
      { op: 'wire', from: 'hole:b16', to: 'rail:bottom+:3' },
    );
    await b.host.step(1);
    expect(b.frame().parts['D1']).toMatchObject({ burnt: true, lit: false });
    // Replace the LED.
    await b.apply({ op: 'remove', id: 'D1' }, { op: 'place', type: 'led-red', at: 'hole:a20' });
    await b.host.step(1);
    expect(b.frame().parts['D2']).toMatchObject({ burnt: false, lit: true });
    expect(b.frame().warnings).toEqual([]);
  });

  it('a 100 Ω resistor lights it over its rating (warning) without killing it', async () => {
    const b = await bench(
      ...LED_TO_GROUND,
      { op: 'place', type: 'resistor-100', at: 'hole:c16' },
      { op: 'wire', from: 'hole:b16', to: 'rail:bottom+:2' },
    );
    expect(b.frame().parts['D1']).toMatchObject({ lit: true, burnt: false, brightness: 1 });
    expect(b.frame().parts['D1']!.milliamps).toBeCloseTo(26, 0);
    expect(b.codes()).toEqual(['OVERCURRENT']);
  });

  it('a 10 kΩ resistor barely lights it; resistance sets the current', async () => {
    const milliamps: number[] = [];
    for (const type of ['resistor-10k', 'resistor-1k', 'resistor', 'resistor-100']) {
      const b = await bench(
        ...LED_TO_GROUND,
        { op: 'place', type, at: 'hole:c16' },
        { op: 'wire', from: 'hole:b16', to: 'rail:bottom+:2' },
      );
      milliamps.push(b.frame().parts['D1']!.milliamps!);
    }
    expect(milliamps.map((x) => Math.round(x * 10) / 10)).toEqual([0.3, 3, 8.7, 26]);
  });
});

describe('Stage-2 voltages', () => {
  it('rails sit at 5 V and 0 V; nets report volts; floating nets report null', async () => {
    const b = await bench();
    expect(b.net('rail:top+:9').volts).toBeCloseTo(5, 3);
    expect(b.net('rail:bottom-:9').volts).toBeCloseTo(0, 3);
    expect(b.net('hole:a1')).toMatchObject({ level: 'Z', volts: null, strength: 'none' });
  });

  it('a supply short trips the bench current limit', async () => {
    const b = await bench({ op: 'wire', from: 'rail:top+:4', to: 'rail:top-:4' });
    expect(b.codes()).toEqual(['SHORT']);
    expect(b.frame().warnings[0]!.message).toMatch(/current limit \(1 A\) exceeded/);
  });

  it('the half adder still plays its truth table with real voltages and no warnings', async () => {
    const b = await bench(...HALF_ADDER.commands);
    const rows: string[] = [];
    for (const [a, bIn] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      await b.apply({ op: 'set', id: 'SW1', value: a }, { op: 'set', id: 'SW2', value: bIn });
      await b.host.step(5);
      const p = b.frame().parts;
      rows.push(`${a}${bIn}:${p['D1']!.lit ? 1 : 0}${p['D2']!.lit ? 1 : 0}`);
      expect(b.frame().warnings).toEqual([]);
    }
    expect(rows).toEqual(['00:00', '01:10', '10:10', '11:01']);
  });
});
