import { describe, expect, it } from 'vitest';
import { benchCircuit, type Circuit } from '../circuit/circuit';
import { applyCommand, type Command } from '../circuit/commands';
import { Simulation } from './engine';

function build(base: Circuit, ...cmds: Command[]): Circuit {
  let c = base;
  for (const cmd of cmds) {
    const r = applyCommand(c, cmd);
    if (!r.ok) throw new Error(`${cmd.op}: ${r.error.code} ${r.error.message}`);
    c = r.circuit;
  }
  return c;
}

/** A powered chip at e10 (VCC pin 14 = f10, GND pin 7 = e16). */
const powered = (type: string): Circuit =>
  build(
    benchCircuit(),
    { op: 'place', type, at: 'hole:e10' },
    { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
    { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
  );

const tie = (pinName: string, rail: string): Command => ({
  op: 'wire',
  from: `pin:U1:${pinName}`,
  to: rail,
});
const HIGH = (i: number) => `rail:top+:${i}`;
const LOW = (i: number) => `rail:top-:${i}`;

describe('Simulation', () => {
  it('starts at tick 0 and only moves on step', () => {
    const sim = new Simulation(benchCircuit());
    expect(sim.time).toEqual({ ticks: 0, ms: 0 });
    sim.step(5);
    expect(sim.time).toEqual({ ticks: 5, ms: 5 });
  });

  it('an unpowered chip drives nothing', () => {
    const c = build(
      benchCircuit(),
      { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
      tie('1', LOW(3)),
      tie('2', LOW(4)),
    );
    const sim = new Simulation(c);
    sim.settle();
    expect(sim.outputLevel('pin:U1:3')).toBe('Z');
  });

  it('a floating input makes the output X (after the delay)', () => {
    const sim = new Simulation(build(powered('chip74hc00'), tie('1', HIGH(3))));
    sim.step();
    expect(sim.outputLevel('pin:U1:3')).toBe('X');
  });

  it.each([
    ['chip74hc00', '1', '2', '3', [1, 1, 1, 0]],
    ['chip74hc08', '1', '2', '3', [0, 0, 0, 1]],
    ['chip74hc02', '2', '3', '1', [1, 0, 0, 0]],
  ] as const)('%s gate 1 truth table on the board', (type, a, b, y, expected) => {
    const got = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ].map(([va, vb]) => {
      const sim = new Simulation(
        build(powered(type), tie(a, va ? HIGH(3) : LOW(3)), tie(b, vb ? HIGH(4) : LOW(4))),
      );
      sim.settle();
      return sim.outputLevel(`pin:U1:${y}`);
    });
    expect(got).toEqual(expected);
  });

  it('74HC04: an inverter chain ripples one tick per gate', () => {
    // 1A ← high; 1Y (pin 2) → 2A (pin 3); 2Y (pin 4) → 3A (pin 5)
    const c = build(
      powered('chip74hc04'),
      tie('1', HIGH(3)),
      { op: 'wire', from: 'pin:U1:2', to: 'pin:U1:3' },
      { op: 'wire', from: 'pin:U1:4', to: 'pin:U1:5' },
    );
    const sim = new Simulation(c);
    const outs = () => ['2', '4', '6'].map((p) => sim.outputLevel(`pin:U1:${p}`));
    expect(outs()).toEqual(['Z', 'Z', 'Z']);
    sim.step();
    expect(outs()[0]).toBe(0);
    sim.step();
    expect(outs().slice(0, 2)).toEqual([0, 1]);
    sim.step();
    expect(outs()).toEqual([0, 1, 0]);
    expect(sim.settle()).toBe(0);
  });

  it('inertial delay: an input pulse undone in the same tick never reaches the output', () => {
    const c0 = build(powered('chip74hc04'), tie('1', LOW(3)));
    const sim = new Simulation(c0);
    sim.settle();
    expect(sim.outputLevel('pin:U1:2')).toBe(1);
    // Flip 1A high, then back low, without a tick in between.
    const high = build(powered('chip74hc04'), tie('1', HIGH(3)));
    sim.load(high);
    sim.load(c0);
    sim.step();
    expect(sim.outputLevel('pin:U1:2')).toBe(1);
    expect(sim.settled).toBe(true);
  });

  it('removing a chip stops its outputs driving', () => {
    const c = build(powered('chip74hc04'), tie('1', LOW(3)));
    const sim = new Simulation(c);
    sim.settle();
    const r = applyCommand(c, { op: 'remove', id: 'U1' });
    sim.load((r as { circuit: Circuit }).circuit);
    expect(sim.outputLevel('pin:U1:2')).toBe('Z');
  });

  it('two outputs fighting raise CONTENTION naming both pins', () => {
    // 1Y (pin 2) driven low (1A high), 2Y (pin 4) driven high (2A low), joined.
    const c = build(powered('chip74hc04'), tie('1', HIGH(3)), tie('3', LOW(3)), {
      op: 'wire',
      from: 'pin:U1:2',
      to: 'pin:U1:4',
    });
    const sim = new Simulation(c);
    sim.step();
    const short = sim.result.warnings.find((w) => w.code === 'CONTENTION');
    expect(short?.at).toEqual(['pin:U1:2', 'pin:U1:4']);
    expect(short?.message).toMatch(/drives low.*drives high/);
  });
});
