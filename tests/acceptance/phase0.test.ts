// Phase 0 acceptance: board geometry, row/rail connectivity, resolveNet
// round-trip, hole hit-testing, and the domain/ import boundary.

import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import {
  boardSpec,
  boardTerminals,
  terminalAtPoint,
  terminalPosition,
} from '../../src/domain/breadboard/spec';
import {
  buildNetlist,
  hole,
  parseTerminal,
  pin,
  rail,
  terminalKey,
  type TerminalRef,
} from '../../src/domain/breadboard/netlist';
import { createBoardLayout } from '../../src/ui/canvas/board-layout';

const half = boardSpec('half');
const full = boardSpec('full');

describe('board geometry', () => {
  it('half-size is 30 rows, 400 tie points', () => {
    expect(half.rows).toBe(30);
    expect(boardTerminals(half)).toHaveLength(300 + 100);
  });

  it('full-size is 63 rows, 830 tie points', () => {
    expect(full.rows).toBe(63);
    expect(boardTerminals(full)).toHaveLength(630 + 200);
  });

  it('places e and f exactly one DIP width (0.3") apart', () => {
    const e = terminalPosition(half, hole('e', 10));
    const f = terminalPosition(half, hole('f', 10));
    expect(e.y - f.y).toBe(3); // e is nearer the viewer
    expect(f.x).toBe(e.x);
  });

  it('keeps every terminal at a distinct position', () => {
    for (const spec of [half, full]) {
      const seen = new Set(
        boardTerminals(spec).map((t) => JSON.stringify(terminalPosition(spec, t))),
      );
      expect(seen.size).toBe(boardTerminals(spec).length);
    }
  });
});

describe('row connectivity', () => {
  const nl = buildNetlist(half);

  it('joins a–e of one row and f–j of one row', () => {
    expect(nl.resolveNet(hole('c', 12)).map(terminalKey)).toEqual([
      'hole:a12',
      'hole:b12',
      'hole:c12',
      'hole:d12',
      'hole:e12',
    ]);
    expect(nl.connected(hole('f', 12), hole('j', 12))).toBe(true);
  });

  it('does not bridge the centre channel', () => {
    expect(nl.connected(hole('e', 12), hole('f', 12))).toBe(false);
  });

  it('does not join neighbouring rows', () => {
    expect(nl.connected(hole('a', 12), hole('a', 13))).toBe(false);
  });

  it('has exactly 2 nets per row plus 4 rail nets', () => {
    expect(nl.nets).toHaveLength(30 * 2 + 4);
  });
});

describe('rail connectivity', () => {
  it('joins each whole rail line on the half-size board', () => {
    const nl = buildNetlist(half);
    expect(nl.resolveNet(rail('top+', 1))).toHaveLength(25);
    expect(nl.connected(rail('top+', 1), rail('top+', 25))).toBe(true);
    expect(nl.connected(rail('bottom-', 1), rail('bottom-', 25))).toBe(true);
  });

  it('keeps + and - and top and bottom separate', () => {
    const nl = buildNetlist(half);
    expect(nl.connected(rail('top+', 1), rail('top-', 1))).toBe(false);
    expect(nl.connected(rail('top+', 1), rail('bottom+', 1))).toBe(false);
    expect(nl.connected(rail('top-', 3), hole('a', 3))).toBe(false);
  });

  it('splits rails in half when splitRails is set', () => {
    const nl = buildNetlist(boardSpec('full', { splitRails: true }));
    expect(nl.connected(rail('top+', 1), rail('top+', 25))).toBe(true);
    expect(nl.connected(rail('top+', 26), rail('top+', 50))).toBe(true);
    expect(nl.connected(rail('top+', 25), rail('top+', 26))).toBe(false);
    expect(nl.nets).toHaveLength(63 * 2 + 8);
  });
});

describe('resolveNet round-trip', () => {
  // A 14-pin DIP with pin 1 at e10, a wire from its pin-1 strip to the + rail,
  // and one loose pin that is registered but not inserted anywhere.
  const dip: Array<readonly [TerminalRef, TerminalRef]> = [];
  for (let n = 1; n <= 7; n++) dip.push([pin('U1', String(n)), hole('e', 9 + n)]);
  for (let n = 8; n <= 14; n++) dip.push([pin('U1', String(n)), hole('f', 24 - n)]);
  const nl = buildNetlist(half, {
    connections: [...dip, [hole('a', 10), rail('top+', 2)]],
    terminals: [pin('D1', 'anode')],
  });

  it('every member of a net resolves back to the same net', () => {
    for (const net of nl.nets) {
      for (const key of net.terminals) {
        const ref = parseTerminal(key);
        expect(nl.netOf(ref)).toBe(net.id);
        expect(nl.resolveNet(ref).map(terminalKey)).toEqual(net.terminals);
      }
    }
  });

  it('every terminal key round-trips through parseTerminal', () => {
    for (const net of nl.nets) {
      for (const key of net.terminals) expect(terminalKey(parseTerminal(key))).toBe(key);
    }
  });

  it('a pin joins its hole strip, and a wire joins the strip to the rail', () => {
    expect(nl.connected(pin('U1', '1'), hole('a', 10))).toBe(true);
    expect(nl.connected(pin('U1', '1'), rail('top+', 25))).toBe(true);
    expect(nl.connected(pin('U1', '14'), hole('j', 10))).toBe(true);
    expect(nl.connected(pin('U1', '1'), pin('U1', '14'))).toBe(false);
    expect(nl.connected(pin('U1', '7'), pin('U1', '8'))).toBe(false);
  });

  it('a registered loose pin is its own net', () => {
    expect(nl.resolveNet(pin('D1', 'anode')).map(terminalKey)).toEqual(['pin:D1:anode']);
  });

  it('net ids are deterministic', () => {
    const again = buildNetlist(half, {
      connections: [[hole('a', 10), rail('top+', 2)], ...[...dip].reverse()],
      terminals: [pin('D1', 'anode')],
    });
    expect(again.nets).toEqual(nl.nets);
  });

  it('rejects terminals that are not on the board', () => {
    expect(() => buildNetlist(half, { connections: [[hole('a', 31), hole('a', 1)]] })).toThrow(
      /not on this half board/,
    );
    expect(() => nl.resolveNet(pin('U9', '1'))).toThrow(/not in this netlist/);
  });
});

describe('hole hit-testing', () => {
  it('every terminal centre hits itself, in pitch and in pixel space', () => {
    const layout = createBoardLayout(half, 20);
    for (const t of boardTerminals(half)) {
      const p = terminalPosition(half, t);
      expect(terminalAtPoint(half, p.x + 0.3, p.y - 0.2)).toEqual(t);
      const back = layout.toPitch(layout.toPixel(p));
      expect(terminalAtPoint(half, back.x, back.y)).toEqual(t);
    }
  });

  it('misses between holes, in the channel, in rail gaps and off the board', () => {
    expect(terminalAtPoint(half, 3.5, 3.5)).toBeNull();
    expect(terminalAtPoint(half, 4, 8.5)).toBeNull();
    // rail hole 5 is at x=4, hole 6 at x=6: x=5 is a gap
    expect(terminalPosition(half, rail('top+', 5)).x).toBe(4);
    expect(terminalPosition(half, rail('top+', 6)).x).toBe(6);
    expect(terminalAtPoint(half, 5, 0)).toBeNull();
    expect(terminalAtPoint(half, 30, 3)).toBeNull();
    expect(terminalAtPoint(half, -1, 3)).toBeNull();
  });
});

describe('domain/ import boundary (ESLint)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const eslint = new ESLint({ cwd: root });

  it('rejects src/domain importing src/ui', async () => {
    const [result] = await eslint.lintText(
      "import { createBoardLayout } from '../../ui/canvas/board-layout';\nexport const x = createBoardLayout;\n",
      { filePath: `${root}src/domain/breadboard/bad.ts` },
    );
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules).toContain('import/no-restricted-paths');
  });

  it('rejects DOM globals inside src/domain', async () => {
    const [result] = await eslint.lintText('export const w = window.innerWidth;\n', {
      filePath: `${root}src/domain/breadboard/bad.ts`,
    });
    expect(result!.messages.map((m) => m.ruleId)).toContain('no-restricted-globals');
  });

  it('allows src/ui importing src/domain', async () => {
    const [result] = await eslint.lintText(
      "import { boardSpec } from '../../domain/breadboard/spec';\nexport const s = boardSpec();\n",
      { filePath: `${root}src/ui/canvas/ok.ts` },
    );
    expect(result!.messages).toEqual([]);
  });
});
