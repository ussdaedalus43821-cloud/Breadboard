// The Circuit: what the user built. Immutable values; every edit goes through
// applyCommand (commands.ts) and returns a new Circuit. See docs/ARCHITECTURE.md §3.

import { boardSpec, type BoardSize, type BoardSpec, type BoardTerminal } from '../breadboard/spec';
import { buildNetlist, type Netlist } from '../breadboard/netlist';
import { pin, terminalKey, type TerminalKey, type TerminalRef } from '../breadboard/terminal';
import type { PlacedPart } from '../parts/types';

export interface Wire {
  readonly id: string;
  readonly from: BoardTerminal;
  readonly to: BoardTerminal;
}

export interface Circuit {
  readonly spec: BoardSpec;
  /** In placement order. */
  readonly parts: readonly PlacedPart[];
  readonly wires: readonly Wire[];
  /** Next number per id prefix. Ids are never reused, even after removal. */
  readonly nextId: Readonly<Record<string, number>>;
}

export function emptyCircuit(
  size: BoardSize = 'half',
  options: { splitRails?: boolean } = {},
): Circuit {
  return { spec: boardSpec(size, options), parts: [], wires: [], nextId: {} };
}

/** What sits in a board terminal: a part pin, a wire end, or nothing. One lead per hole. */
export type Occupant =
  | { readonly kind: 'pin'; readonly part: string; readonly pin: string }
  | { readonly kind: 'wire'; readonly wire: string; readonly end: 'from' | 'to' };

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
  return map;
}

export function findPart(circuit: Circuit, id: string): PlacedPart | undefined {
  return circuit.parts.find((p) => p.id === id);
}

/**
 * The static netlist: board strips and rails, each pin joined to its hole,
 * each wire's two ends joined. Switch contacts are not included — whether a
 * switch conducts is sim state (Phase 2), not wiring.
 */
export function circuitNetlist(circuit: Circuit): Netlist {
  const connections: Array<readonly [TerminalRef, TerminalRef]> = [];
  for (const part of circuit.parts) {
    for (const [name, t] of Object.entries(part.pins)) connections.push([pin(part.id, name), t]);
  }
  for (const w of circuit.wires) connections.push([w.from, w.to]);
  return buildNetlist(circuit.spec, { connections });
}
