import { describe, expect, it } from 'vitest';
import { MAX_PARTS } from '../protocol/bridge';
import {
  createResponseBuffer,
  awaitResponse,
  resetResponse,
  writeResponse,
  RESPONSE_CAPACITY,
} from '../protocol/sync-buffer';
import { handleBridge } from './bridge';
import { SimService } from './sim-service';

const call = (s: SimService, op: string, ...args: unknown[]) =>
  handleBridge(s, JSON.stringify({ v: 2, id: 7, op, args })).response;

describe('bridge dispatcher', () => {
  it('echoes the request id and version', () => {
    expect(call(new SimService(), 'sim.time')).toEqual({
      v: 2,
      id: 7,
      ok: true,
      result: { ticks: 0, ms: 0 },
    });
    const v1 = handleBridge(new SimService(), { v: 1, id: 3, op: 'sim.time', args: [] }).response;
    expect(v1).toMatchObject({ v: 1, id: 3, ok: true });
  });

  it.each([
    ['an unknown op', { v: 2, id: 1, op: 'eval', args: ['1+1'] }],
    ['a raw op', { v: 2, id: 1, op: 'command', args: [] }],
    ['an unsupported version', { v: 3, id: 1, op: 'sim.time', args: [] }],
    [
      'board.resistor on a v1 request',
      { v: 1, id: 1, op: 'board.resistor', args: [330, 'hole:a1', 'hole:a5'] },
    ],
    ['a non-object', 42],
  ])('refuses %s with BAD_ARGS', (_, req) => {
    expect(handleBridge(new SimService(), req).response).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });

  it('refuses malformed JSON with BAD_ARGS', () => {
    expect(handleBridge(new SimService(), '{nope').response).toMatchObject({
      ok: false,
      error: { code: 'BAD_ARGS' },
    });
  });

  it('checks argument count and types', () => {
    const s = new SimService();
    expect(call(s, 'board.wire', 'hole:a1')).toMatchObject({
      error: { code: 'BAD_ARGS', message: 'board.wire takes 2 arguments, got 1' },
    });
    expect(call(s, 'board.run', '10')).toMatchObject({ error: { code: 'BAD_ARGS' } });
    expect(call(s, 'board.new', 'tiny')).toMatchObject({ error: { code: 'BAD_ARGS' } });
  });

  it.each(['7400', '74HC00', '74hc00'])('board.chip accepts %s', (name) => {
    const s = new SimService();
    call(s, 'board.new', 'half');
    expect(call(s, 'board.chip', name, 'hole:e10')).toMatchObject({
      ok: true,
      result: { type: 'chip74hc00' },
    });
  });

  it('caps parts per board', () => {
    const s = new SimService();
    call(s, 'board.new', 'full');
    let refused: unknown = null;
    for (let i = 0; i <= MAX_PARTS && !refused; i++) {
      const row = 1 + Math.floor(i / 5);
      const col = 'abcdefghij'[(i % 5) * 2]!;
      const r = call(
        s,
        'board.led',
        `hole:${col}${row}`,
        `hole:${'abcdefghij'[(i % 5) * 2 + 1]}${row}`,
      );
      if (!r.ok) refused = r;
    }
    expect(s.state.circuit.parts).toHaveLength(MAX_PARTS);
    expect(refused).toMatchObject({ error: { code: 'LIMIT' } });
  });

  it('sim.get tells terminals from part ids', () => {
    const s = new SimService();
    call(s, 'board.new', 'half');
    call(s, 'board.power', 'rail:top+:1');
    expect(call(s, 'sim.get', 'rail:top+:9')).toMatchObject({
      ok: true,
      result: { level: 1, volts: 5 },
    });
    expect(call(s, 'sim.get', 'hole:a31')).toMatchObject({ error: { code: 'BAD_TERMINAL' } });
    expect(call(s, 'sim.get', 'pin:U1:1')).toMatchObject({ error: { code: 'BAD_TERMINAL' } });
    expect(call(s, 'sim.get', 'U1')).toMatchObject({ error: { code: 'UNKNOWN_PART' } });
  });

  it('collects the circuit and frame pushes the UI should see', () => {
    const s = new SimService();
    const { pushes } = handleBridge(s, { v: 2, id: 1, op: 'board.new', args: ['half'] });
    expect(pushes.map((m) => m.kind)).toEqual(['circuit', 'frame']);
  });
});

describe('shared response buffer', () => {
  it('round-trips a response, multibyte text included', () => {
    const buf = createResponseBuffer();
    resetResponse(buf);
    expect(writeResponse(buf, '{"ok":true,"result":"330 Ω"}')).toBe(true);
    expect(awaitResponse(buf, 10)).toBe('{"ok":true,"result":"330 Ω"}');
  });

  it('times out when nothing is written', () => {
    const buf = createResponseBuffer();
    resetResponse(buf);
    expect(awaitResponse(buf, 5)).toBeNull();
  });

  it('refuses a response larger than 1 MiB', () => {
    expect(writeResponse(createResponseBuffer(), 'x'.repeat(RESPONSE_CAPACITY + 1))).toBe(false);
  });
});
