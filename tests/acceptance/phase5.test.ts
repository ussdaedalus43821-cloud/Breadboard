// Phase 5 acceptance: save/load, shareable URLs, undo/redo, the inspector's
// resistor values, and wires whose two pin ends share a strip.
//   - Save a half adder, "refresh" (a brand-new sim), load it back, and the
//     NovaLang test script still prints PASS.
//   - Undo/redo works for placing and deleting parts.
//   - A shared URL loads the circuit.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hole, terminalKey } from '../../src/domain/breadboard/terminal';
import { benchCircuit, type Circuit } from '../../src/domain/circuit/circuit';
import { applyCommand, type Command } from '../../src/domain/circuit/commands';
import { fromSave, toSave } from '../../src/domain/circuit/save';
import { HALF_ADDER } from '../../src/domain/demos/half-adder';
import type { SimFrame } from '../../src/protocol/sim-protocol';
import { Editor } from '../../src/ui/editor/editor';
import { decodeShareHash, encodeShareHash } from '../../src/ui/persistence/share';
import { listSaves, readSave, writeSave } from '../../src/ui/persistence/storage';
import { SimService } from '../../src/worker/sim-service';
import { connectInProcess, type Connected } from '../support/in-process-host';
import { bench as novaBench, novaRuntime, read } from '../support/nova-node';

const HALF_ADDER_NOVA = read('public/nova/examples/half_adder.nova');
const TEST_VECTORS = read('public/nova/examples/test_vectors.nova');

beforeAll(async () => {
  await novaRuntime();
}, 60_000);

const open: Connected[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

async function host(preset: 'bench' | 'empty' = 'bench') {
  const c = await connectInProcess({ preset });
  open.push(c);
  let frame: SimFrame | null = null;
  c.host.subscribeFrames((f) => (frame = f));
  let circuit: Circuit | null = null;
  c.host.subscribe((x) => (circuit = x));
  const apply = async (...cmds: Command[]) => {
    for (const cmd of cmds) {
      const r = await c.host.apply(cmd);
      if (!r.ok) throw new Error(`${cmd.op}: ${r.error.message}`);
    }
  };
  return {
    host: c.host,
    apply,
    frame: () => frame!,
    circuit: () => circuit!,
    ids: () => circuit!.parts.map((p) => p.id),
  };
}

/** A minimal in-memory Storage, standing in for the browser's localStorage. */
function fakeLocalStorage(): void {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

describe('acceptance: save a half adder, refresh, load it back, run the test script', () => {
  it('prints PASS on the reloaded circuit', async () => {
    fakeLocalStorage();
    // Build it with NovaLang, as a user would.
    const before = novaBench();
    expect((await before.run(HALF_ADDER_NOVA)).outcome).toEqual({ ok: true });
    expect(
      writeSave('half adder', toSave(before.service.state.circuit, { title: 'half adder' })),
    ).toBeNull();
    expect(listSaves().map((s) => s.name)).toEqual(['half adder']);

    // "Refresh": a brand-new sim worker knows nothing. Load from storage.
    const fresh = new SimService();
    const [response] = fresh
      .handle({ v: 1, id: 1, kind: 'load', save: readSave('half adder') })
      .slice(-1);
    expect(response).toMatchObject({ ok: true });
    expect(fresh.state.circuit.parts.map((p) => p.id)).toEqual([
      'SW1',
      'SW2',
      'U1',
      'D1',
      'R1',
      'D2',
      'R2',
    ]);
    expect(toSave(fresh.state.circuit, { title: 'half adder' })).toEqual(
      toSave(before.service.state.circuit, { title: 'half adder' }),
    );

    const { outcome, stdout } = await novaBench(fresh).run(TEST_VECTORS);
    expect(outcome).toEqual({ ok: true });
    expect(stdout.at(-1)).toBe('PASS');
  });
});

describe('acceptance: undo/redo for placing and deleting parts', () => {
  it('undoes and redoes a placement', async () => {
    const h = await host();
    await h.apply({ op: 'place', type: 'led-red', at: 'hole:a10' });
    expect(h.ids()).toEqual(['D1']);
    expect(h.frame().history).toMatchObject({
      canUndo: true,
      undoLabel: 'place D1',
      canRedo: false,
    });

    expect(await h.host.undo()).toEqual({ ok: true, id: 'place D1' });
    expect(h.ids()).toEqual([]);
    expect(h.frame().history).toMatchObject({ canRedo: true, redoLabel: 'place D1' });

    expect(await h.host.redo()).toEqual({ ok: true, id: 'place D1' });
    expect(h.ids()).toEqual(['D1']);
    expect(terminalKey(h.circuit().parts[0]!.pins['anode']!)).toBe('hole:a10');
  });

  it('undoes a deletion: the part comes back with its id and holes', async () => {
    const h = await host();
    await h.apply({ op: 'place', type: 'chip74hc00', at: 'hole:e10' }, { op: 'remove', id: 'U1' });
    expect(h.ids()).toEqual([]);
    await h.host.undo();
    expect(h.ids()).toEqual(['U1']);
    expect(terminalKey(h.circuit().parts[0]!.pins['14']!)).toBe('hole:f10');
    await h.host.redo();
    expect(h.ids()).toEqual([]);
  });

  it('a new edit after undo drops the redo branch', async () => {
    const h = await host();
    await h.apply({ op: 'place', type: 'led-red', at: 'hole:a10' });
    await h.host.undo();
    await h.apply({ op: 'place', type: 'resistor', at: 'hole:a1' });
    expect(h.frame().history.canRedo).toBe(false);
    expect(await h.host.redo()).toMatchObject({ ok: false, error: { message: 'nothing to redo' } });
  });

  it('through the editor and the Delete key path', async () => {
    const h = await host();
    const editor = new Editor(h.host);
    editor.setTool({ kind: 'part', type: 'resistor' });
    await editor.pointerDown(hole('a', 3));
    editor.setTool({ kind: 'select' });
    await editor.pointerDown(hole('a', 3));
    expect(editor.selected).toBe('R1');
    await editor.removeSelected();
    expect(h.ids()).toEqual([]);
    expect(editor.selected).toBeNull();
    await h.host.undo();
    expect(h.ids()).toEqual(['R1']);
  });

  it('switch flips are operating, not editing: they are not recorded', async () => {
    const h = await host();
    await h.apply(
      { op: 'place', type: 'switch-spst', at: 'hole:a3' },
      { op: 'set', id: 'SW1', value: 1 },
    );
    expect(h.frame().history.undoLabel).toBe('place SW1');
    await h.host.undo();
    expect(h.ids()).toEqual([]);
  });

  it('a whole script run, and Clear board, each undo as one step', async () => {
    const h = await host();
    await h.host.group(true, 'script run');
    for (const cmd of HALF_ADDER.commands) await h.apply(cmd);
    await h.host.group(false);
    expect(h.ids()).toHaveLength(9);
    expect(h.frame().history.undoLabel).toBe('script run');
    expect(await h.host.undo()).toMatchObject({ ok: true });
    expect(h.ids()).toEqual([]);
    await h.host.redo();
    expect(h.ids()).toHaveLength(9);

    await h.host.clear();
    expect(h.ids()).toEqual([]);
    expect(h.frame().history.undoLabel).toBe('clear board');
    await h.host.undo();
    expect(h.ids()).toHaveLength(9);
  });

  it('undo is refused while a group (a script) is open', async () => {
    const h = await host();
    await h.apply({ op: 'place', type: 'led-red', at: 'hole:a10' });
    await h.host.group(true);
    expect(await h.host.undo()).toMatchObject({ ok: false });
    await h.host.group(false);
    expect(await h.host.undo()).toMatchObject({ ok: true });
  });
});

describe('acceptance: a shared URL loads the circuit', () => {
  it('encodes into a compact fragment and decodes to the same circuit', async () => {
    const built = HALF_ADDER.commands.reduce<Circuit>((c, cmd) => {
      const r = applyCommand(c, cmd);
      if (!r.ok) throw new Error(r.error.message);
      return r.circuit;
    }, benchCircuit());
    const hash = await encodeShareHash(toSave(built));
    expect(hash).toMatch(/^#circuit=1\.[A-Za-z0-9_-]+$/);
    expect(hash.length).toBeLessThan(2000);

    const h = await host('empty');
    expect(await h.host.load(await decodeShareHash(hash))).toMatchObject({ ok: true });
    expect(toSave(h.circuit())).toEqual(toSave(built));
    for (const [a, b, sum, carry] of [
      [1, 0, true, false],
      [1, 1, false, true],
    ] as const) {
      await h.apply({ op: 'set', id: 'SW1', value: a }, { op: 'set', id: 'SW2', value: b });
      await h.host.step(5);
      expect([h.frame().parts['D1']!.lit, h.frame().parts['D2']!.lit]).toEqual([sum, carry]);
    }
  });

  it('ignores other fragments and reports a damaged link', async () => {
    expect(await decodeShareHash('#somewhere')).toBeNull();
    expect(await decodeShareHash('')).toBeNull();
    await expect(decodeShareHash('#circuit=1.not-really-deflate')).rejects.toThrow(
      /damaged or incomplete/,
    );
  });
});

describe('save format', () => {
  const build = (...cmds: Command[]) =>
    cmds.reduce<Circuit>((c, cmd) => {
      const r = applyCommand(c, cmd);
      if (!r.ok) throw new Error(r.error.message);
      return r.circuit;
    }, benchCircuit());

  it('keeps ids with gaps, switch positions, and never reuses ids after a load', () => {
    const c = build(
      { op: 'place', type: 'led-red', at: 'hole:a1' },
      { op: 'place', type: 'led-red', at: 'hole:a5' },
      { op: 'remove', id: 'D1' },
      { op: 'place', type: 'switch-spdt', at: 'hole:a10' },
      { op: 'set', id: 'SW1', value: 1 },
    );
    const loaded = fromSave(JSON.parse(JSON.stringify(toSave(c))));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.circuit.parts.map((p) => [p.id, p.state])).toEqual([
      ['D2', undefined],
      ['SW1', { position: 1 }],
    ]);
    const next = applyCommand(loaded.circuit, { op: 'place', type: 'led-red', at: 'hole:a20' });
    expect(next).toMatchObject({ ok: true, id: 'D3' });
  });

  it('matches the documented shape', () => {
    const save = toSave(
      build(
        { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
        { op: 'placeLeads', type: 'led-red', pins: { anode: 'hole:a20', cathode: 'hole:a21' } },
      ),
    );
    expect(save).toMatchObject({
      format: 'breadboard',
      version: 1,
      board: { size: 'half', splitRails: false },
      parts: [
        { id: 'U1', type: 'chip74hc00', at: 'hole:e10' },
        { id: 'D1', type: 'led-red', pins: { anode: 'hole:a20', cathode: 'hole:a21' } },
      ],
      supplies: expect.arrayContaining([
        { id: 'VCC1', kind: 'power', at: 'rail:top+:1', volts: 5 },
      ]),
    });
  });

  it.each([
    ['not a save', { hello: 1 }, /not a Breadboard save/],
    ['a future version', { format: 'breadboard', version: 2 }, /unsupported save version 2/],
    [
      'a bad board',
      { format: 'breadboard', version: 1, board: { size: 'huge' } },
      /bad board size/,
    ],
    [
      'an unknown part',
      {
        format: 'breadboard',
        version: 1,
        board: { size: 'half' },
        parts: [{ id: 'X1', type: 'flux', at: 'hole:a1' }],
      },
      /unknown type "flux"/,
    ],
    [
      'overlapping parts',
      {
        format: 'breadboard',
        version: 1,
        board: { size: 'half' },
        parts: [
          { id: 'D1', type: 'led-red', pins: { anode: 'hole:a1', cathode: 'hole:a2' } },
          { id: 'D2', type: 'led-red', pins: { anode: 'hole:a1', cathode: 'hole:a3' } },
        ],
      },
      /part D2: hole:a1 already holds pin:D1:anode/,
    ],
    [
      'a duplicate id',
      {
        format: 'breadboard',
        version: 1,
        board: { size: 'half' },
        parts: [
          { id: 'D1', type: 'led-red', pins: { anode: 'hole:a1', cathode: 'hole:a2' } },
          { id: 'D1', type: 'led-red', pins: { anode: 'hole:a5', cathode: 'hole:a6' } },
        ],
      },
      /duplicate id D1/,
    ],
    [
      'an id that does not match its type',
      {
        format: 'breadboard',
        version: 1,
        board: { size: 'half' },
        parts: [{ id: 'U1', type: 'led-red', pins: { anode: 'hole:a1', cathode: 'hole:a2' } }],
      },
      /id prefix does not match/,
    ],
  ])('refuses %s with a readable reason', (_, save, message) => {
    expect(fromSave(save)).toMatchObject({ ok: false, error: expect.stringMatching(message) });
  });

  it('does not save sim state (burnt, lit, currents, levels)', async () => {
    const h = await host();
    await h.apply({
      op: 'placeLeads',
      type: 'led-red',
      pins: { anode: 'rail:top+:3', cathode: 'rail:top-:3' },
    });
    expect(h.frame().parts['D1']!.burnt).toBe(true);
    expect(JSON.stringify(toSave(h.circuit()))).not.toMatch(
      /"(burnt|lit|milliamps|brightness|level|time|ticks)"/,
    );
  });
});

describe('fixed: a wire whose two pin ends share a strip', () => {
  it('lands in two distinct free holes of that strip', async () => {
    const h = await host();
    await h.apply(
      { op: 'place', type: 'led-red', at: 'hole:a10' }, // anode a10
      { op: 'placeLeads', type: 'resistor', pins: { '1': 'hole:c10', '2': 'hole:c14' } }, // pin 1 also row 10
      { op: 'wire', from: 'pin:D1:anode', to: 'pin:R1:1' },
    );
    const w = h.circuit().wires[0]!;
    expect([terminalKey(w.from), terminalKey(w.to)]).toEqual(['hole:b10', 'hole:d10']);
  });

  it('works from NovaLang too', async () => {
    const { outcome, stdout } = await novaBench().run(`
board.new("half")
let d = board.led("hole:a10", "hole:a11")
let r = board.resistor(330, "hole:c10", "hole:c14")
let w = board.wire(d["pins"]["anode"], r["pins"]["1"])
print(w["from"], w["to"])
`);
    expect(outcome).toEqual({ ok: true });
    expect(stdout).toEqual(['hole:b10 hole:d10']);
  });
});

describe('inspector: change a resistor value in place', () => {
  it('changes the type, keeps id and holes, changes the current, and undoes', async () => {
    const h = await host();
    await h.apply(
      { op: 'place', type: 'led-red', at: 'hole:a20' },
      { op: 'wire', from: 'hole:b21', to: 'rail:bottom-:2' },
      { op: 'place', type: 'resistor', at: 'hole:c16' },
      { op: 'wire', from: 'hole:b16', to: 'rail:bottom+:2' },
    );
    await h.host.step(1);
    expect(h.frame().parts['D1']!.milliamps).toBeCloseTo(8.7, 0);

    const editor = new Editor(h.host);
    editor.setTool({ kind: 'select' });
    await editor.pointerDown(hole('c', 16));
    expect(editor.selected).toBe('R1');
    await editor.setResistance(100);
    const r1 = h.circuit().parts.find((p) => p.id === 'R1')!;
    expect(r1.type).toBe('resistor-100');
    expect(terminalKey(r1.pins['1']!)).toBe('hole:c16');
    expect(h.frame().parts['D1']!.milliamps).toBeCloseTo(26, 0);
    expect(h.frame().history.undoLabel).toBe('change R1');

    await h.host.undo();
    expect(h.circuit().parts.find((p) => p.id === 'R1')!.type).toBe('resistor');
  });

  it('refuses values that are not stocked and parts that are not resistors', () => {
    const c = benchCircuit();
    const withR = applyCommand(c, { op: 'place', type: 'resistor', at: 'hole:a1' });
    const withD = applyCommand((withR as { circuit: Circuit }).circuit, {
      op: 'place',
      type: 'led-red',
      at: 'hole:a10',
    });
    const circuit = (withD as { circuit: Circuit }).circuit;
    expect(applyCommand(circuit, { op: 'setResistance', id: 'R1', ohms: 47 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(applyCommand(circuit, { op: 'setResistance', id: 'D1', ohms: 100 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
    expect(applyCommand(circuit, { op: 'setResistance', id: 'R9', ohms: 100 })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_PART' },
    });
  });
});
