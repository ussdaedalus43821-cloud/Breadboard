// Breadboard geometry, in pitch units (1 unit = 0.1" = 2.54 mm).
// See docs/ARCHITECTURE.md §5. Pixels are the renderer's business.
//
// Layout (landscape, row numbers run left to right along x). Columns a–e
// sit nearest the viewer, as on most real boards, so a DIP chip with pin 1
// in column e reads like the real part: notch left, pin 1 bottom-left,
// numbering counterclockwise seen from above.
//
//   y=0   top+     ─ ─ ─ ─ ─   ─ ─ ─ ─ ─   …   rail holes, groups of 5
//   y=1   top-     ─ ─ ─ ─ ─   ─ ─ ─ ─ ─   …
//   y=3   j  ┐
//    …       ├ one terminal strip per row (f–j)
//   y=7   f  ┘
//         ── centre channel (f→e is 0.3", one DIP width) ──
//   y=10  e  ┐
//    …       ├ one terminal strip per row (a–e)
//   y=14  a  ┘
//   y=16  bottom-
//   y=17  bottom+

import {
  COLUMNS,
  RAILS,
  hole,
  rail,
  type ColumnLetter,
  type HoleRef,
  type RailId,
  type RailRef,
  type TerminalRef,
} from './terminal';

export type BoardSize = 'half' | 'full';

/** A terminal that physically exists on the board (not a part pin). */
export type BoardTerminal = HoleRef | RailRef;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoardSpec {
  readonly size: BoardSize;
  readonly rows: number;
  readonly railHolesPerLine: number;
  readonly railGroupSize: number;
  /** Each rail line is two independent halves (common on full-size boards). */
  readonly splitRails: boolean;
  /** x of rail hole 1; rail holes are centred along the board. */
  readonly railOffset: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardOptions {
  readonly splitRails?: boolean;
}

const COLUMN_Y: Readonly<Record<ColumnLetter, number>> = {
  j: 3,
  i: 4,
  h: 5,
  g: 6,
  f: 7,
  e: 10,
  d: 11,
  c: 12,
  b: 13,
  a: 14,
};

const RAIL_Y: Readonly<Record<RailId, number>> = {
  'top+': 0,
  'top-': 1,
  'bottom-': 16,
  'bottom+': 17,
};

const BOARD_HEIGHT = 18;
const RAIL_GROUP_SIZE = 5;

const SIZES: Readonly<Record<BoardSize, { rows: number; railHolesPerLine: number }>> = {
  half: { rows: 30, railHolesPerLine: 25 },
  full: { rows: 63, railHolesPerLine: 50 },
};

/** Width in pitches spanned by a rail line, including the gaps between groups. */
function railSpan(holes: number, groupSize: number): number {
  return holes + Math.ceil(holes / groupSize) - 1;
}

export function boardSpec(size: BoardSize = 'half', options: BoardOptions = {}): BoardSpec {
  const { rows, railHolesPerLine } = SIZES[size];
  const span = railSpan(railHolesPerLine, RAIL_GROUP_SIZE);
  return {
    size,
    rows,
    railHolesPerLine,
    railGroupSize: RAIL_GROUP_SIZE,
    splitRails: options.splitRails ?? false,
    railOffset: Math.floor((rows - span) / 2),
    width: rows,
    height: BOARD_HEIGHT,
  };
}

export const HALF_SIZE: BoardSpec = boardSpec('half');
export const FULL_SIZE: BoardSpec = boardSpec('full');

export function isOnBoard(spec: BoardSpec, ref: TerminalRef): ref is BoardTerminal {
  switch (ref.kind) {
    case 'hole':
      return (
        COLUMNS.includes(ref.column) &&
        Number.isInteger(ref.row) &&
        ref.row >= 1 &&
        ref.row <= spec.rows
      );
    case 'rail':
      return (
        RAILS.includes(ref.rail) &&
        Number.isInteger(ref.index) &&
        ref.index >= 1 &&
        ref.index <= spec.railHolesPerLine
      );
    case 'pin':
      return false;
  }
}

/** Every hole and rail hole, in a stable order (holes by row then column, then rails). */
export function boardTerminals(spec: BoardSpec): BoardTerminal[] {
  const out: BoardTerminal[] = [];
  for (let row = 1; row <= spec.rows; row++) {
    for (const column of COLUMNS) out.push(hole(column, row));
  }
  for (const railId of RAILS) {
    for (let index = 1; index <= spec.railHolesPerLine; index++) out.push(rail(railId, index));
  }
  return out;
}

/**
 * Groups of terminals the board itself connects: one per row half (a–e, f–j)
 * and one per rail line (or rail half when splitRails is set).
 */
export function boardConnections(spec: BoardSpec): BoardTerminal[][] {
  const groups: BoardTerminal[][] = [];
  for (let row = 1; row <= spec.rows; row++) {
    groups.push(COLUMNS.slice(0, 5).map((c) => hole(c, row)));
    groups.push(COLUMNS.slice(5).map((c) => hole(c, row)));
  }
  const half = Math.ceil(spec.railHolesPerLine / 2);
  for (const railId of RAILS) {
    const line: RailRef[] = [];
    for (let index = 1; index <= spec.railHolesPerLine; index++) line.push(rail(railId, index));
    if (spec.splitRails) {
      groups.push(line.slice(0, half), line.slice(half));
    } else {
      groups.push(line);
    }
  }
  return groups;
}

function railX(spec: BoardSpec, index: number): number {
  const k = index - 1;
  return spec.railOffset + k + Math.floor(k / spec.railGroupSize);
}

/** Centre of a terminal in pitch coordinates. Throws for refs not on the board. */
export function terminalPosition(spec: BoardSpec, ref: TerminalRef): Point {
  if (!isOnBoard(spec, ref)) {
    throw new RangeError(`not a terminal on this ${spec.size} board: ${JSON.stringify(ref)}`);
  }
  if (ref.kind === 'hole') return { x: ref.row - 1, y: COLUMN_Y[ref.column] };
  return { x: railX(spec, ref.index), y: RAIL_Y[ref.rail] };
}

/** Default hit radius in pitches: a little under half the pitch, so holes never overlap. */
export const HIT_RADIUS = 0.45;

/** The board terminal whose centre is within `radius` of (x, y), or null. */
export function terminalAtPoint(
  spec: BoardSpec,
  x: number,
  y: number,
  radius: number = HIT_RADIUS,
): BoardTerminal | null {
  const gx = Math.round(x);
  const gy = Math.round(y);
  if (Math.hypot(x - gx, y - gy) > radius) return null;

  const column = COLUMNS.find((c) => COLUMN_Y[c] === gy);
  if (column) {
    const ref = hole(column, gx + 1);
    return isOnBoard(spec, ref) ? ref : null;
  }

  const railId = RAILS.find((r) => RAIL_Y[r] === gy);
  if (railId) {
    const p = gx - spec.railOffset;
    if (p < 0) return null;
    const stride = spec.railGroupSize + 1;
    const within = p % stride;
    if (within === spec.railGroupSize) return null; // gap between groups
    const ref = rail(railId, Math.floor(p / stride) * spec.railGroupSize + within + 1);
    return isOnBoard(spec, ref) ? ref : null;
  }
  return null;
}
