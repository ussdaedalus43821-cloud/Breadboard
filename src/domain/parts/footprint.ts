// Where a part's pins land on the board.

import {
  terminalAtPoint,
  terminalPosition,
  type BoardSpec,
  type BoardTerminal,
} from '../breadboard/spec';
import { terminalKey } from '../breadboard/terminal';
import type { PartDef } from './types';

export type FootprintResult =
  | { readonly ok: true; readonly pins: Readonly<Record<string, BoardTerminal>> }
  | { readonly ok: false; readonly reason: string };

/** Resolve a part's default footprint with its anchor pin in `anchor`. */
export function footprintAt(spec: BoardSpec, def: PartDef, anchor: BoardTerminal): FootprintResult {
  if (def.anchorColumns) {
    if (anchor.kind !== 'hole' || !def.anchorColumns.includes(anchor.column)) {
      return {
        ok: false,
        reason: `${def.label} pin ${def.pins[0]!.pin} must be in column ${def.anchorColumns.join('/')}, got ${terminalKey(anchor)}`,
      };
    }
  }
  const origin = terminalPosition(spec, anchor);
  const pins: Record<string, BoardTerminal> = {};
  for (const fp of def.pins) {
    // Offsets are exact pitches, so a tiny radius only absorbs float error.
    const t = terminalAtPoint(spec, origin.x + fp.dx, origin.y + fp.dy, 0.01);
    if (!t) {
      return { ok: false, reason: `${def.label} pin ${fp.pin} would be off the board or in a gap` };
    }
    pins[fp.pin] = t;
  }
  return { ok: true, pins };
}
