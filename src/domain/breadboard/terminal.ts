// TerminalRef: the one and only way to name an electrical connection point.
// See docs/ARCHITECTURE.md §4. Every hole, rail hole, part pin and wire end
// is a TerminalRef; its canonical string key is what crosses JSON boundaries.

export const COLUMNS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
export type ColumnLetter = (typeof COLUMNS)[number];

export const RAILS = ['top+', 'top-', 'bottom+', 'bottom-'] as const;
export type RailId = (typeof RAILS)[number];

export interface HoleRef {
  readonly kind: 'hole';
  readonly column: ColumnLetter;
  /** 1-based row number. */
  readonly row: number;
}

export interface RailRef {
  readonly kind: 'rail';
  readonly rail: RailId;
  /** 1-based hole index along the rail line. */
  readonly index: number;
}

export interface PinRef {
  readonly kind: 'pin';
  readonly part: string;
  readonly pin: string;
}

export type TerminalRef = HoleRef | RailRef | PinRef;

/** Canonical string form of a TerminalRef, e.g. `hole:e15`. */
export type TerminalKey = string;

export const PART_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
export const PIN_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export class TerminalRefError extends Error {
  override name = 'TerminalRefError';
}

export function hole(column: ColumnLetter, row: number): HoleRef {
  return { kind: 'hole', column, row };
}

export function rail(railId: RailId, index: number): RailRef {
  return { kind: 'rail', rail: railId, index };
}

export function pin(part: string, pinName: string): PinRef {
  return { kind: 'pin', part, pin: pinName };
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

/** Canonical key for a ref. Throws if the ref is malformed. */
export function terminalKey(ref: TerminalRef): TerminalKey {
  switch (ref.kind) {
    case 'hole':
      if (!COLUMNS.includes(ref.column) || !isPositiveInteger(ref.row)) {
        throw new TerminalRefError(`malformed hole ref: ${JSON.stringify(ref)}`);
      }
      return `hole:${ref.column}${ref.row}`;
    case 'rail':
      if (!RAILS.includes(ref.rail) || !isPositiveInteger(ref.index)) {
        throw new TerminalRefError(`malformed rail ref: ${JSON.stringify(ref)}`);
      }
      return `rail:${ref.rail}:${ref.index}`;
    case 'pin':
      if (!PART_ID_PATTERN.test(ref.part) || !PIN_NAME_PATTERN.test(ref.pin)) {
        throw new TerminalRefError(`malformed pin ref: ${JSON.stringify(ref)}`);
      }
      return `pin:${ref.part}:${ref.pin}`;
  }
}

const HOLE_KEY = /^hole:([a-j])([1-9][0-9]*)$/;
const RAIL_KEY = /^rail:(top\+|top-|bottom\+|bottom-):([1-9][0-9]*)$/;
const PIN_KEY = /^pin:([A-Za-z][A-Za-z0-9_]*):([A-Za-z0-9_]+)$/;

/** Parse a canonical key. Exact inverse of terminalKey; throws on anything else. */
export function parseTerminal(key: string): TerminalRef {
  let m = HOLE_KEY.exec(key);
  if (m) return hole(m[1] as ColumnLetter, Number(m[2]));
  m = RAIL_KEY.exec(key);
  if (m) return rail(m[1] as RailId, Number(m[2]));
  m = PIN_KEY.exec(key);
  if (m) return pin(m[1]!, m[2]!);
  throw new TerminalRefError(`not a TerminalRef key: ${JSON.stringify(key)}`);
}

export function sameTerminal(a: TerminalRef, b: TerminalRef): boolean {
  return terminalKey(a) === terminalKey(b);
}
