// The Circuit: what the user built. Immutable values; every edit goes through
// applyCommand (commands.ts) and returns a new Circuit. See docs/ARCHITECTURE.md §3.

import {
  boardSpec,
  terminalPosition,
  type BoardSize,
  type BoardSpec,
  type BoardTerminal,
} from '../breadboard/spec';
import { buildNetlist, type Netlist } from '../breadboard/netlist';
import { pin, rail, terminalKey, type TerminalKey, type TerminalRef } from '../breadboard/terminal';
import { getPartDef } from '../parts/registry';
import type { PlacedPart } from '../parts/types';

export interface Wire {
  readonly id: string;
  readonly from: BoardTerminal;
  readonly to: BoardTerminal;
}

/**
 * A bench-instrument lead plugged into a board terminal: +5 V, ground, or a
 * function generator's 0/5 V square wave (`clock`), high for the first half
 * of each period.
 */
export interface Supply {
  readonly id: string;
  readonly kind: 'power' | 'ground' | 'clock';
  readonly at: BoardTerminal;
  readonly volts: number;
  /** Clock leads only: period in ticks (even, ≥ 2). 10 ticks = 100 Hz. */
  readonly periodTicks?: number;
}

/** Clock-lead periods the UI offers, in ticks (1 tick = 1 ms). */
export const CLOCK_PERIODS: readonly number[] = [2, 10, 20, 100, 1000];
export const DEFAULT_CLOCK_PERIOD = 10;

/** A clock lead's level at tick `t`: high for the first half of each period. */
export function clockLevel(periodTicks: number, t: number): 0 | 1 {
  return Math.floor(t / (periodTicks / 2)) % 2 === 0 ? 1 : 0;
}

export interface Circuit {
  readonly spec: BoardSpec;
  /** In placement order. */
  readonly parts: readonly PlacedPart[];
  readonly wires: readonly Wire[];
  readonly supplies: readonly Supply[];
  /** Next number per id prefix. Ids are never reused, even after removal. */
  readonly nextId: Readonly<Record<string, number>>;
}

export function emptyCircuit(
  size: BoardSize = 'half',
  options: { splitRails?: boolean } = {},
): Circuit {
  return { spec: boardSpec(size, options), parts: [], wires: [], supplies: [], nextId: {} };
}

/**
 * The editor's starting board: +5 V on both + rails and ground on both −
 * rails, at hole 1 (and at the first hole of the second half too when the
 * rails are split). `board.new` in the bridge starts from emptyCircuit instead.
 */
export function benchCircuit(
  size: BoardSize = 'half',
  options: { splitRails?: boolean } = {},
): Circuit {
  const base = emptyCircuit(size, options);
  const starts = base.spec.splitRails ? [1, Math.ceil(base.spec.railHolesPerLine / 2) + 1] : [1];
  const supplies: Supply[] = [];
  const nextId: Record<string, number> = { VCC: 1, GND: 1 };
  for (const [railId, kind] of [
    ['top+', 'power'],
    ['top-', 'ground'],
    ['bottom+', 'power'],
    ['bottom-', 'ground'],
  ] as const) {
    for (const index of starts) {
      const prefix = kind === 'power' ? 'VCC' : 'GND';
      supplies.push({
        id: `${prefix}${nextId[prefix]!++}`,
        kind,
        at: rail(railId, index),
        volts: kind === 'power' ? 5 : 0,
      });
    }
  }
  return { ...base, supplies, nextId };
}

/** What sits in a board terminal: a part pin, a wire end, a supply lead, or nothing. One lead per hole. */
export type Occupant =
  | { readonly kind: 'pin'; readonly part: string; readonly pin: string }
  | { readonly kind: 'wire'; readonly wire: string; readonly end: 'from' | 'to' }
  | { readonly kind: 'supply'; readonly supply: string };

export function occupancy(circuit: Circuit): Map<TerminalKey, Occupant> {
  const map = new Map<TerminalKey, Occupant>();
  for (const part of circuit.parts) {
    for (const [name, t] of Object.entries(part.pins)) {
      map.set(terminalKey(t), { kind: 'pin', part: part.id, pin: name });
    }
  }
  for (const w of circuit.wires) {
    map.set(terminalKey(w.from), { kind: 'wire', wire: w.id, end: 'from' });
    map.set(terminalKey(w.to), { kind: 'wire', wire: w.id, end: 'to' });
  }
  for (const s of circuit.supplies) map.set(terminalKey(s.at), { kind: 'supply', supply: s.id });
  return map;
}

export function findPart(circuit: Circuit, id: string): PlacedPart | undefined {
  return circuit.parts.find((p) => p.id === id);
}

/** Occupant's id: the part, wire or supply that owns the lead. */
export function occupantId(o: Occupant): string {
  return o.kind === 'pin' ? o.part : o.kind === 'wire' ? o.wire : o.supply;
}

/**
 * The static netlist: board strips and rails, each pin joined to its hole,
 * each wire's two ends joined. Switch contacts are not included — whether a
 * switch conducts is sim state, joined by the solver (domain/sim).
 */
export function circuitNetlist(circuit: Circuit): Netlist {
  const connections: Array<readonly [TerminalRef, TerminalRef]> = [];
  for (const part of circuit.parts) {
    for (const [name, t] of Object.entries(part.pins)) connections.push([pin(part.id, name), t]);
    // Pins the part joins internally (a display's two COM pins).
    for (const group of getPartDef(part.type).internalNets ?? []) {
      for (const other of group.slice(1))
        connections.push([pin(part.id, group[0]!), pin(part.id, other)]);
    }
  }
  for (const w of circuit.wires) connections.push([w.from, w.to]);
  return buildNetlist(circuit.spec, { connections });
}

/**
 * The part under pitch point (x, y). A fixed footprint (chip, switch, display)
 * is hit anywhere in its pins' bounding box plus half a pitch; a flexible-lead
 * part (LED, resistor) only near the line between its leads, so a long
 * diagonal resistor does not swallow clicks on whatever it crosses. Last
 * placed wins, matching draw order.
 */
export function partAtPoint(circuit: Circuit, x: number, y: number): PlacedPart | undefined {
  for (let i = circuit.parts.length - 1; i >= 0; i--) {
    const part = circuit.parts[i]!;
    const ps = Object.values(part.pins).map((t) => terminalPosition(circuit.spec, t));
    if (getPartDef(part.type).leads === 'flexible' && ps.length === 2) {
      if (distanceToSegment(x, y, ps[0]!, ps[1]!) <= 0.5) return part;
      continue;
    }
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    if (
      x >= Math.min(...xs) - 0.5 &&
      x <= Math.max(...xs) + 0.5 &&
      y >= Math.min(...ys) - 0.5 &&
      y <= Math.max(...ys) + 0.5
    ) {
      return part;
    }
  }
  return undefined;
}

function distanceToSegment(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/**
 * The wire whose line passes within `radius` pitches of point (x, y), nearest
 * first; ties go to the last drawn. For clicking a wire to probe it.
 */
export function wireAtPoint(
  circuit: Circuit,
  x: number,
  y: number,
  radius = 0.35,
): Wire | undefined {
  let best: Wire | undefined;
  let bestDist = radius;
  for (const w of circuit.wires) {
    const d = distanceToSegment(
      x,
      y,
      terminalPosition(circuit.spec, w.from),
      terminalPosition(circuit.spec, w.to),
    );
    if (d <= bestDist) [best, bestDist] = [w, d];
  }
  return best;
}
