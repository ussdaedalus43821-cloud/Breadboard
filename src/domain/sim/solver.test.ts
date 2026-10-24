import { describe, expect, it } from 'vitest';
import { pin, terminalKey, type TerminalRef } from '../breadboard/terminal';
import { benchCircuit, emptyCircuit, type Circuit } from '../circuit/circuit';
import { applyCommand, type Command } from '../circuit/commands';
import { solve, type Level, type SimResult } from './solver';

function build(base: Circuit, ...cmds: Command[]): Circuit {
  let c = base;
  for (const cmd of cmds) {
    const r = applyCommand(c, cmd);
    if (!r.ok) throw new Error(`${cmd.op}: ${r.error.code} ${r.error.message}`);
    c = r.circuit;
  }
  return c;
}

function levelOf(r: SimResult, ref: TerminalRef): Level {
  const key = terminalKey(ref);
  return r.nets.find((n) => n.terminals.includes(key))!.level;
}

const hole = (k: string): TerminalRef => ({
  kind: 'hole',
  column: k[0] as 'a',
  row: Number(k.slice(1)),
});

describe('Stage-1 solver', () => {
  it('an empty board is all Z with no warnings', () => {
    const r = solve(emptyCircuit());
    expect(r.nets.every((n) => n.level === 'Z' && n.strength === 'none')).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('the bench supply drives the rails strongly', () => {
    const r = solve(benchCircuit());
    expect(levelOf(r, { kind: 'rail', rail: 'top+', index: 25 })).toBe(1);
    expect(levelOf(r, { kind: 'rail', rail: 'bottom-', index: 7 })).toBe(0);
    expect(r.nets.find((n) => n.terminals.includes('rail:top+:1'))!.strength).toBe('strong');
  });

  it('wires carry strong levels; untouched strips stay Z', () => {
    const r = solve(build(benchCircuit(), { op: 'wire', from: 'rail:top+:2', to: 'hole:a5' }));
    expect(levelOf(r, hole('e5'))).toBe(1);
    expect(levelOf(r, hole('f5'))).toBe('Z');
  });

  it('a short between +5 V and ground is X with a SHORT warning', () => {
    const r = solve(build(benchCircuit(), { op: 'wire', from: 'rail:top+:2', to: 'rail:top-:2' }));
    expect(levelOf(r, { kind: 'rail', rail: 'top+', index: 3 })).toBe('X');
    expect(r.warnings.map((w) => w.code)).toEqual(['SHORT']);
  });

  it('a resistor passes a weak level; a divider is X', () => {
    let c = build(
      benchCircuit(),
      { op: 'wire', from: 'rail:top+:2', to: 'hole:a5' },
      { op: 'place', type: 'resistor', at: 'hole:b5' }, // b5–b9
    );
    let r = solve(c);
    expect(levelOf(r, hole('e9'))).toBe(1);
    expect(r.nets.find((n) => n.terminals.includes('hole:e9'))!.strength).toBe('weak');

    c = build(
      c,
      { op: 'wire', from: 'rail:bottom-:2', to: 'hole:a13' },
      { op: 'place', type: 'resistor', at: 'hole:c9' },
    ); // c9–c13
    r = solve(c);
    expect(levelOf(r, hole('e9'))).toBe('X');
  });

  it('an LED lights only forward-biased, and never makes a floating net driven', () => {
    const forward = build(benchCircuit(), {
      op: 'placeLeads',
      type: 'led-red',
      pins: { anode: 'rail:top+:3', cathode: 'rail:top-:3' },
    });
    // Straight across the rails: lit, but far over its rating (the engine burns it out).
    expect(solve(forward).parts['D1']).toMatchObject({ lit: true, burnt: false });
    expect(solve(forward).warnings.map((w) => w.code)).toEqual(['OVERCURRENT']);

    const reverse = build(benchCircuit(), {
      op: 'placeLeads',
      type: 'led-red',
      pins: { anode: 'rail:top-:3', cathode: 'rail:top+:3' },
    });
    expect(solve(reverse).parts['D1']).toMatchObject({ lit: false, milliamps: 0 });

    const halfConnected = build(benchCircuit(), {
      op: 'placeLeads',
      type: 'led-red',
      pins: { anode: 'rail:top+:3', cathode: 'hole:a9' },
    });
    const r = solve(halfConnected);
    expect(r.parts['D1']).toMatchObject({ lit: false });
    expect(levelOf(r, hole('a9'))).toBe('Z');
  });

  it('an SPST joins its pins only when closed', () => {
    const open = build(
      benchCircuit(),
      { op: 'place', type: 'switch-spst', at: 'hole:a3' }, // a3, a5
      { op: 'wire', from: 'rail:top+:2', to: 'hole:b3' },
    );
    expect(levelOf(solve(open), hole('e5'))).toBe('Z');
    const closed = build(open, { op: 'set', id: 'SW1', value: 1 });
    expect(levelOf(solve(closed), hole('e5'))).toBe(1);
    expect(solve(closed).parts['SW1']).toEqual({ position: 1 });
  });

  it('an SPDT routes com to a (position 0) or b (position 1)', () => {
    const c = build(
      benchCircuit(),
      { op: 'place', type: 'switch-spdt', at: 'hole:a3' }, // a: a3, com: a4, b: a5
      { op: 'wire', from: 'rail:top+:2', to: 'hole:b3' },
      { op: 'wire', from: 'rail:top-:2', to: 'hole:b5' },
    );
    expect(levelOf(solve(c), pin('SW1', 'com'))).toBe(1);
    expect(levelOf(solve(build(c, { op: 'set', id: 'SW1', value: 1 })), pin('SW1', 'com'))).toBe(0);
  });

  it('is deterministic', () => {
    const c = build(benchCircuit(), { op: 'place', type: 'chip74hc00', at: 'hole:e10' });
    expect(JSON.stringify(solve(c))).toBe(JSON.stringify(solve(c)));
  });
});

describe('set command', () => {
  it('only switches, only 0 or 1', () => {
    const c = build(
      benchCircuit(),
      { op: 'place', type: 'led-red', at: 'hole:a1' },
      { op: 'place', type: 'switch-spst', at: 'hole:a5' },
    );
    expect(applyCommand(c, { op: 'set', id: 'D1', value: 1 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(applyCommand(c, { op: 'set', id: 'SW1', value: 2 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(applyCommand(c, { op: 'set', id: 'SW9', value: 1 })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_PART' },
    });
  });
});
