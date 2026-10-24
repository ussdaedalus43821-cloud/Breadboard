// Phase 1 acceptance: parts registry, click-to-place, drag-to-wire.
// Headline criterion: place two parts, wire them, and the wire resolves to the
// same net as the two pins.

import { describe, expect, it } from 'vitest';
import { hole, pin, rail, terminalKey } from '../../src/domain/breadboard/terminal';
import { circuitNetlist, emptyCircuit, type Circuit } from '../../src/domain/circuit/circuit';
import { applyCommand, type Command } from '../../src/domain/circuit/commands';
import { getPartDef, partTypes } from '../../src/domain/parts/registry';
import { PART_ID_PATTERN, PIN_NAME_PATTERN } from '../../src/domain/breadboard/terminal';
import { Editor } from '../../src/ui/editor/editor';
import { LocalCircuitHost } from '../../src/ui/local-circuit-host';

/** Apply commands in order, failing the test on the first refusal. */
function build(...cmds: Command[]): Circuit {
  let c = emptyCircuit();
  for (const cmd of cmds) {
    const r = applyCommand(c, cmd);
    if (!r.ok) throw new Error(`${cmd.op} refused: ${r.error.code} ${r.error.message}`);
    c = r.circuit;
  }
  return c;
}

describe('acceptance: two parts wired together share one net', () => {
  it('through the command dispatcher', () => {
    const c = build(
      { op: 'place', type: 'led-red', at: 'hole:a10' }, // anode a10, cathode a11
      { op: 'place', type: 'resistor', at: 'hole:c20' }, // pin 1 c20, pin 2 c24
      { op: 'wire', from: 'hole:e11', to: 'hole:e20' },
    );
    const nl = circuitNetlist(c);
    const wire = c.wires[0]!;
    const net = nl.netOf(wire.from);

    expect(nl.netOf(wire.to)).toBe(net);
    expect(nl.netOf(pin('D1', 'cathode'))).toBe(net);
    expect(nl.netOf(pin('R1', '1'))).toBe(net);
    const members = nl.resolveNet(pin('D1', 'cathode')).map(terminalKey);
    expect(members).toEqual(
      expect.arrayContaining(['pin:D1:cathode', 'pin:R1:1', 'hole:e11', 'hole:e20']),
    );

    // ...and nothing else leaked in.
    expect(nl.connected(pin('D1', 'anode'), pin('D1', 'cathode'))).toBe(false);
    expect(nl.connected(pin('R1', '1'), pin('R1', '2'))).toBe(false);
    expect(members.filter((k) => k.startsWith('pin:'))).toEqual(['pin:D1:cathode', 'pin:R1:1']);
  });

  it('through the editor: palette tool, click a hole, drag a wire', async () => {
    const host = new LocalCircuitHost();
    const editor = new Editor(host);

    editor.setTool({ kind: 'part', type: 'switch-spst' });
    await editor.pointerDown(hole('b', 5)); // SW1: pin 1 b5, pin 2 b7
    editor.setTool({ kind: 'part', type: 'led-red' });
    await editor.pointerDown(hole('b', 15)); // D1: anode b15, cathode b16
    editor.setTool({ kind: 'wire' });
    // Drag starting on a hole that holds a pin: wired "to that pin".
    await editor.pointerDown(hole('b', 7));
    editor.pointerMove(hole('d', 15));
    expect(editor.preview()).toMatchObject({ kind: 'wire', valid: true });
    await editor.pointerUp(hole('d', 15));

    const c = editor.current;
    expect(c.parts.map((p) => p.id)).toEqual(['SW1', 'D1']);
    expect(c.wires).toHaveLength(1);
    const nl = circuitNetlist(c);
    const w = c.wires[0]!;
    expect(nl.netOf(w.from)).toBe(nl.netOf(pin('SW1', '2')));
    expect(nl.netOf(w.to)).toBe(nl.netOf(pin('D1', 'anode')));
    expect(nl.connected(pin('SW1', '2'), pin('D1', 'anode'))).toBe(true);
    expect(editor.message).toBe('Wired W1.');
  });
});

describe('parts registry', () => {
  it('has every palette part', () => {
    expect(partTypes()).toEqual(['led-red', 'resistor', 'switch-spst', 'chip74hc00']);
  });

  it.each(partTypes())('%s is well-formed', (type) => {
    const def = getPartDef(type);
    expect(PART_ID_PATTERN.test(`${def.idPrefix}1`)).toBe(true);
    const names = def.pins.map((p) => p.pin);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(PIN_NAME_PATTERN.test(n)).toBe(true);
    expect(def.pins[0]).toMatchObject({ dx: 0, dy: 0 });
  });

  it('rejects unknown types', () => {
    const r = applyCommand(emptyCircuit(), { op: 'place', type: 'flux-capacitor', at: 'hole:a1' });
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TYPE' } });
  });
});

describe('74HC00 placeholder straddles the channel like the real part', () => {
  const c = build({ op: 'place', type: 'chip74hc00', at: 'hole:e10' });
  const u1 = c.parts[0]!;

  it('pins 1–7 run along e, 8–14 come back along f (counterclockwise from above)', () => {
    const at = (n: number) => terminalKey(u1.pins[String(n)]!);
    expect([1, 2, 3, 4, 5, 6, 7].map(at)).toEqual([
      'hole:e10',
      'hole:e11',
      'hole:e12',
      'hole:e13',
      'hole:e14',
      'hole:e15',
      'hole:e16',
    ]);
    expect([8, 9, 10, 11, 12, 13, 14].map(at)).toEqual([
      'hole:f16',
      'hole:f15',
      'hole:f14',
      'hole:f13',
      'hole:f12',
      'hole:f11',
      'hole:f10',
    ]);
  });

  it('every pin is on its own net', () => {
    const nl = circuitNetlist(c);
    const nets = new Set(Object.keys(u1.pins).map((n) => nl.netOf(pin('U1', n))));
    expect(nets.size).toBe(14);
  });

  it('must have pin 1 in column e, and fit on the board', () => {
    expect(
      applyCommand(emptyCircuit(), { op: 'place', type: 'chip74hc00', at: 'hole:a10' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'BAD_PLACEMENT' },
    });
    expect(
      applyCommand(emptyCircuit(), { op: 'place', type: 'chip74hc00', at: 'hole:e25' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'BAD_PLACEMENT' },
    });
    expect(
      applyCommand(emptyCircuit(), { op: 'place', type: 'chip74hc00', at: 'hole:e24' }).ok,
    ).toBe(true);
  });
});

describe('placement and wiring rules', () => {
  it('one lead per hole', () => {
    const c = build({ op: 'place', type: 'chip74hc00', at: 'hole:e10' });
    expect(applyCommand(c, { op: 'place', type: 'led-red', at: 'hole:e16' })).toMatchObject({
      ok: false,
      error: { code: 'OCCUPIED' },
    });
    expect(applyCommand(c, { op: 'wire', from: 'hole:e12', to: 'hole:a1' })).toMatchObject({
      ok: false,
      error: { code: 'OCCUPIED' },
    });
  });

  it('a wire to a pin lands in the nearest free hole joined to it', () => {
    const c = build(
      { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
      { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:1' },
      { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:1' },
    );
    expect(terminalKey(c.wires[0]!.from)).toBe('hole:g10');
    expect(terminalKey(c.wires[1]!.from)).toBe('hole:d16');
    const nl = circuitNetlist(c);
    expect(nl.connected(pin('U1', '14'), rail('top+', 25))).toBe(true);
    expect(nl.connected(pin('U1', '7'), rail('bottom-', 25))).toBe(true);
  });

  it('flexible leads can go anywhere free; fixed footprints cannot', () => {
    const c = build({
      op: 'placeLeads',
      type: 'led-red',
      pins: { anode: 'hole:a3', cathode: 'rail:bottom-:2' },
    });
    expect(terminalKey(c.parts[0]!.pins['cathode']!)).toBe('rail:bottom-:2');
    expect(
      applyCommand(c, {
        op: 'placeLeads',
        type: 'switch-spst',
        pins: { '1': 'hole:a5', '2': 'hole:a9' },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(
      applyCommand(c, { op: 'placeLeads', type: 'resistor', pins: { '1': 'hole:a5' } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });

  it('rejects bad terminals and self-wires', () => {
    const c = emptyCircuit();
    expect(applyCommand(c, { op: 'wire', from: 'e15', to: 'hole:a1' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_TERMINAL' },
    });
    expect(applyCommand(c, { op: 'wire', from: 'hole:a31', to: 'hole:a1' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_TERMINAL' },
    });
    expect(applyCommand(c, { op: 'wire', from: 'pin:U9:1', to: 'hole:a1' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_TERMINAL' },
    });
    expect(applyCommand(c, { op: 'wire', from: 'hole:a1', to: 'hole:a1' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(applyCommand(c, { op: 'explode' } as unknown as Command)).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });

  it('remove frees the holes; ids are never reused', () => {
    let c = build(
      { op: 'place', type: 'led-red', at: 'hole:a10' },
      { op: 'wire', from: 'hole:b10', to: 'hole:b20' },
      { op: 'remove', id: 'D1' },
      { op: 'remove', id: 'W1' },
      { op: 'place', type: 'led-red', at: 'hole:a10' },
    );
    expect(c.parts.map((p) => p.id)).toEqual(['D2']);
    expect(c.wires).toEqual([]);
    const r = applyCommand(c, { op: 'remove', id: 'D1' });
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PART' } });
    c = build({ op: 'place', type: 'resistor', at: 'hole:a1' });
    expect(c.parts[0]!.id).toBe('R1');
  });

  it('commands and circuits survive JSON (they will cross the worker boundary)', () => {
    const c = build(
      { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
      { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:1' },
    );
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('editor previews and refusals', () => {
  it('shows a valid ghost over free holes and an invalid one over taken holes', async () => {
    const editor = new Editor(new LocalCircuitHost());
    editor.setTool({ kind: 'part', type: 'chip74hc00' });
    editor.pointerMove(hole('e', 10));
    expect(editor.preview()).toMatchObject({ kind: 'part', valid: true });
    await editor.pointerDown(hole('e', 10));
    editor.pointerMove(hole('e', 12));
    expect(editor.preview()).toMatchObject({ kind: 'part', valid: false });
    await editor.pointerDown(hole('e', 12));
    expect(editor.message).toMatch(/^OCCUPIED: /);
    expect(editor.current.parts).toHaveLength(1);
  });

  it('a drag released on the start hole or off the board adds nothing', async () => {
    const editor = new Editor(new LocalCircuitHost());
    editor.setTool({ kind: 'wire' });
    await editor.pointerDown(hole('a', 1));
    await editor.pointerUp(hole('a', 1));
    await editor.pointerDown(hole('a', 1));
    await editor.pointerUp(null);
    expect(editor.current.wires).toEqual([]);
  });

  it('right-click removes the part or wire in that hole', async () => {
    const editor = new Editor(new LocalCircuitHost());
    editor.setTool({ kind: 'part', type: 'resistor' });
    await editor.pointerDown(hole('a', 1));
    editor.setTool({ kind: 'select' });
    await editor.removeAt(hole('a', 5));
    expect(editor.current.parts).toEqual([]);
    expect(editor.message).toBe('Removed R1.');
  });
});
