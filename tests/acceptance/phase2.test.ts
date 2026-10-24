// Phase 2 acceptance: circuit state lives behind the sim-worker protocol, the
// Stage-1 solver lights an LED through a switch and resistor from the 5 V
// rail, and an unconnected gate raises floating-input warnings.

import { afterEach, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { hole, terminalKey } from '../../src/domain/breadboard/terminal';
import type { SimFrame } from '../../src/protocol/sim-protocol';
import { Editor } from '../../src/ui/editor/editor';
import { SimService } from '../../src/worker/sim-service';
import { connectInProcess, type Connected } from '../support/in-process-host';

const open: Connected[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

async function bench() {
  const c = await connectInProcess({ preset: 'bench' });
  open.push(c);
  let frame: SimFrame | null = null;
  c.host.subscribeFrames((f) => (frame = f));
  const apply = async (...cmds: Parameters<typeof c.host.apply>[0][]) => {
    for (const cmd of cmds) {
      const r = await c.host.apply(cmd);
      if (!r.ok) throw new Error(`${cmd.op}: ${r.error.code} ${r.error.message}`);
    }
  };
  return { host: c.host, apply, frame: () => frame! };
}

const floatingPins = (f: SimFrame) =>
  f.warnings.filter((w) => w.code === 'FLOATING_INPUT').flatMap((w) => w.at);

describe('acceptance: a disconnected gate raises floating-input warnings', () => {
  it('every input of an unwired 74HC00 is reported floating', async () => {
    const b = await bench();
    await b.apply({ op: 'place', type: 'chip74hc00', at: 'hole:e10' });
    expect(floatingPins(b.frame())).toEqual(
      ['1', '2', '4', '5', '9', '10', '12', '13'].map((n) => `pin:U1:${n}`),
    );
    // Outputs and supply pins are not inputs, so they never raise FLOATING_INPUT...
    for (const n of ['3', '6', '8', '11', '7', '14']) {
      expect(floatingPins(b.frame())).not.toContain(`pin:U1:${n}`);
    }
    // ...but an unpowered chip is its own warning.
    expect(
      b
        .frame()
        .warnings.filter((w) => w.code === 'CHIP_UNPOWERED')
        .flatMap((w) => w.at),
    ).toEqual(['pin:U1:7', 'pin:U1:14']);
  });

  it('wiring the gate clears its warnings, one input left loose keeps exactly one', async () => {
    const b = await bench();
    await b.apply(
      { op: 'place', type: 'chip74hc00', at: 'hole:e10' },
      { op: 'wire', from: 'pin:U1:14', to: 'rail:top+:2' },
      { op: 'wire', from: 'pin:U1:7', to: 'rail:bottom-:2' },
    );
    // Tie every input but 4B (pin 13) high or low, directly or through a pull-up.
    for (const [n, rail] of [
      ['1', 'rail:top+:3'],
      ['2', 'rail:top+:4'],
      ['4', 'rail:bottom-:3'],
      ['5', 'rail:bottom-:4'],
      ['9', 'rail:top+:5'],
      ['10', 'rail:top-:2'],
    ] as const) {
      await b.apply({ op: 'wire', from: `pin:U1:${n}`, to: rail });
    }
    await b.apply(
      { op: 'place', type: 'resistor', at: 'hole:i8' }, // i8–i12: pull-up on pin 12's strip
      { op: 'wire', from: 'hole:h8', to: 'rail:top+:6' },
    );
    expect(b.frame().warnings.map((w) => `${w.code} ${w.at.join()}`)).toEqual([
      'FLOATING_INPUT pin:U1:13',
    ]);
    expect(b.frame().warnings[0]!.message).toBe(
      'U1 pin 13 (4B) is floating: connect it to a driven net',
    );

    await b.apply({ op: 'wire', from: 'pin:U1:13', to: 'rail:top-:3' });
    expect(b.frame().warnings).toEqual([]);
  });
});

describe('acceptance: 5 V rail → switch → resistor → LED → ground', () => {
  // SW1 b3/b5 · rail top+ → a3 · R1 d5–d9 · D1 anode c9, cathode c10 · a10 → rail bottom−
  const cmds = [
    { op: 'place', type: 'switch-spst', at: 'hole:b3' },
    { op: 'wire', from: 'rail:top+:2', to: 'hole:a3' },
    { op: 'place', type: 'resistor', at: 'hole:d5' },
    { op: 'place', type: 'led-red', at: 'hole:c9' },
    { op: 'wire', from: 'hole:a10', to: 'rail:bottom-:2' },
  ] as const;

  it('the LED is dark with the switch open and lights when it is closed', async () => {
    const b = await bench();
    await b.apply(...cmds);
    expect(b.frame().parts['D1']).toEqual({ lit: false });

    await b.apply({ op: 'set', id: 'SW1', value: 1 });
    expect(b.frame().parts['D1']).toEqual({ lit: true });
    const anode = b.frame().nets.find((n) => n.terminals.includes('pin:D1:anode'))!;
    expect(anode).toMatchObject({ level: 1, strength: 'weak' });

    await b.apply({ op: 'set', id: 'SW1', value: 0 });
    expect(b.frame().parts['D1']).toEqual({ lit: false });
    expect(b.frame().warnings).toEqual([]);
  });

  it('same circuit built and toggled through the editor', async () => {
    const b = await bench();
    const editor = new Editor(b.host);
    const click = async (tool: Parameters<Editor['setTool']>[0], at: string) => {
      editor.setTool(tool);
      await editor.pointerDown(hole(at[0] as 'a', Number(at.slice(1))));
    };
    const drag = async (
      from: Parameters<Editor['pointerDown']>[0],
      to: Parameters<Editor['pointerUp']>[0],
    ) => {
      editor.setTool({ kind: 'wire' });
      await editor.pointerDown(from);
      await editor.pointerUp(to);
    };
    await click({ kind: 'part', type: 'switch-spst' }, 'b3');
    await drag({ kind: 'rail', rail: 'top+', index: 2 }, hole('a', 3));
    await click({ kind: 'part', type: 'resistor' }, 'd5');
    await click({ kind: 'part', type: 'led-red' }, 'c9');
    await drag(hole('a', 10), { kind: 'rail', rail: 'bottom-', index: 2 });
    expect(editor.frame!.parts['D1']).toEqual({ lit: false });

    editor.setTool({ kind: 'select' });
    await editor.pointerDown(null, { x: 3, y: 13 }); // the switch body between b3 and b5
    expect(editor.message).toBe('SW1 closed.');
    expect(editor.frame!.parts['D1']).toEqual({ lit: true });
    expect(editor.levelOf(terminalKey(hole('e', 9)))).toBe(1);

    await editor.pointerDown(hole('b', 5)); // clicking a switch pin also toggles it
    expect(editor.message).toBe('SW1 open.');
    expect(editor.frame!.parts['D1']).toEqual({ lit: false });
  });
});

describe('the sim worker protocol', () => {
  it('pushes circuit and frame before the response, with matching revisions', () => {
    const s = new SimService();
    const out = s.handle({
      v: 1,
      id: 7,
      kind: 'command',
      cmd: { op: 'place', type: 'led-red', at: 'hole:a1' },
    });
    expect(out.map((m) => m.kind)).toEqual(['circuit', 'frame', 'response']);
    const [c, f, r] = out as unknown as [
      { revision: number },
      { frame: SimFrame },
      { id: number; ok: boolean },
    ];
    expect(c.revision).toBe(f.frame.revision);
    expect(r).toMatchObject({ id: 7, ok: true, result: { id: 'D1' } });
  });

  it('refusals come back with the dispatcher code and change nothing', () => {
    const s = new SimService();
    expect(
      s.handle({ v: 1, id: 1, kind: 'command', cmd: { op: 'wire', from: 'e15', to: 'hole:a1' } }),
    ).toEqual([
      expect.objectContaining({
        kind: 'response',
        id: 1,
        ok: false,
        error: expect.objectContaining({ code: 'BAD_TERMINAL' }),
      }),
    ]);
  });

  it('rejects malformed requests without throwing', () => {
    const s = new SimService();
    for (const junk of [
      null,
      42,
      {},
      { v: 2, id: 1, kind: 'hello' },
      { v: 1, id: 2, kind: 'eval', code: 'x' },
    ]) {
      const [r] = s.handle(junk);
      expect(r).toMatchObject({ kind: 'response', ok: false, error: { code: 'BAD_REQUEST' } });
    }
    expect(s.handle({ v: 1, id: 3, kind: 'command', cmd: null })).toEqual([
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'BAD_ARGS' }) }),
    ]);
  });

  it('every message is JSON-clean (structured-clone safe)', async () => {
    const b = await bench();
    await b.apply(...[{ op: 'place', type: 'chip74hc00', at: 'hole:e10' } as const]);
    expect(JSON.parse(JSON.stringify(b.frame()))).toEqual(b.frame());
  });
});

describe('ui/ cannot reach into worker/ (ESLint)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const eslint = new ESLint({ cwd: root });

  it('rejects src/ui importing src/worker', async () => {
    const [result] = await eslint.lintText(
      "import { SimService } from '../worker/sim-service';\nexport const s = new SimService();\n",
      { filePath: `${root}src/ui/bad.ts` },
    );
    expect(result!.messages.map((m) => m.ruleId)).toContain('import/no-restricted-paths');
  });
});
