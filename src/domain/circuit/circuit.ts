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
import type { PlacedPart } from '../parts/types';

export interface Wire {
  readonly id: string;
  readonly from: BoardTerminal;
  readonly to: BoardTerminal;
}

/** A bench-supply lead plugged into a board terminal: +5 V or ground. */
export interface Supply {
  readonly id: string;
  readonly kind: 'power' | 'ground';
  readonly at: BoardTerminal;
  readonly volts: number;
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
  }
  for (const w of circuit.wires) connections.push([w.from, w.to]);
  return buildNetlist(circuit.spec, { connections });
}

/**
 * The part whose body covers pitch point (x, y): the pins' bounding box plus
 * half a pitch. Last placed wins, matching draw order.
 */
export function partAtPoint(circuit: Circuit, x: number, y: number): PlacedPart | undefined {
  for (let i = circuit.parts.length - 1; i >= 0; i--) {
    const part = circuit.parts[i]!;
    const ps = Object.values(part.pins).map((t) => terminalPosition(circuit.spec, t));
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
