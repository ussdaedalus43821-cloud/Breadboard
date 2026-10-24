// The edit command dispatcher. One validation path for every client: the UI
// today, the sim worker's message handler in Phase 2, NovaLang in Phase 4.5,
// save/load replay in Phase 5. Commands and results are plain JSON.

import {
  boardConnections,
  isOnBoard,
  terminalPosition,
  type BoardTerminal,
} from '../breadboard/spec';
import {
  parseTerminal,
  pin,
  terminalKey,
  TerminalRefError,
  type TerminalKey,
  type TerminalRef,
} from '../breadboard/terminal';
import { footprintAt } from '../parts/footprint';
import { getPartDef, hasPartDef } from '../parts/registry';
import type { PlacedPart } from '../parts/types';
import { findPart, occupancy, type Circuit, type Supply } from './circuit';

export type Command =
  /** Place a part's default footprint with its anchor pin at `at`. */
  | { readonly op: 'place'; readonly type: string; readonly at: TerminalKey }
  /** Place a flexible-lead part with each pin in an explicit hole. */
  | {
      readonly op: 'placeLeads';
      readonly type: string;
      readonly pins: Readonly<Record<string, TerminalKey>>;
    }
  /** Add a jumper wire. A `pin:` end goes into the nearest free hole joined to that pin (D-011). */
  | { readonly op: 'wire'; readonly from: TerminalKey; readonly to: TerminalKey }
  /** Plug a +5 V bench-supply lead into `at` (normally a rail hole). */
  | { readonly op: 'power'; readonly at: TerminalKey }
  /** Plug a ground lead into `at`. */
  | { readonly op: 'ground'; readonly at: TerminalKey }
  /** Set a part's user state. v1: switches only, value 0 or 1 (`position`). */
  | { readonly op: 'set'; readonly id: string; readonly value: number }
  /** Remove a part, wire or supply by id. */
  | { readonly op: 'remove'; readonly id: string };

/** Error codes shared with docs/NOVALANG_BRIDGE.md §4. */
export type ErrorCode =
  'BAD_ARGS' | 'BAD_TERMINAL' | 'BAD_PLACEMENT' | 'OCCUPIED' | 'UNKNOWN_PART' | 'UNKNOWN_TYPE';

export interface CommandError {
  readonly code: ErrorCode;
  readonly message: string;
}

export type CommandResult =
  | { readonly ok: true; readonly circuit: Circuit; readonly id: string }
  | { readonly ok: false; readonly error: CommandError };

class Rejection extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function boardTerminal(circuit: Circuit, key: unknown): BoardTerminal {
  if (typeof key !== 'string')
    throw new Rejection('BAD_ARGS', `expected a TerminalRef key, got ${JSON.stringify(key)}`);
  let ref: TerminalRef;
  try {
    ref = parseTerminal(key);
  } catch (e) {
    if (e instanceof TerminalRefError) throw new Rejection('BAD_TERMINAL', e.message);
    throw e;
  }
  if (ref.kind === 'pin') {
    const part = findPart(circuit, ref.part);
    const t = part?.pins[ref.pin];
    if (!t) throw new Rejection('BAD_TERMINAL', `${key} is not a pin on this board`);
    return t;
  }
  if (!isOnBoard(circuit.spec, ref)) {
    throw new Rejection('BAD_TERMINAL', `${key} is not on this ${circuit.spec.size} board`);
  }
  return ref;
}

function allocateId(circuit: Circuit, prefix: string): { id: string; nextId: Circuit['nextId'] } {
  const n = circuit.nextId[prefix] ?? 1;
  return { id: `${prefix}${n}`, nextId: { ...circuit.nextId, [prefix]: n + 1 } };
}

function assertFree(circuit: Circuit, terminals: readonly BoardTerminal[]): void {
  const occupied = occupancy(circuit);
  const seen = new Set<TerminalKey>();
  for (const t of terminals) {
    const key = terminalKey(t);
    if (seen.has(key)) throw new Rejection('BAD_PLACEMENT', `two leads would share ${key}`);
    seen.add(key);
    const who = occupied.get(key);
    if (who) {
      const what =
        who.kind === 'pin'
          ? terminalKey(pin(who.part, who.pin))
          : who.kind === 'wire'
            ? `wire ${who.wire}`
            : `supply ${who.supply}`;
      throw new Rejection('OCCUPIED', `${key} already holds ${what}`);
    }
  }
}

function addPart(
  circuit: Circuit,
  type: string,
  pins: Readonly<Record<string, BoardTerminal>>,
): CommandResult {
  const def = getPartDef(type);
  assertFree(circuit, Object.values(pins));
  const { id, nextId } = allocateId(circuit, def.idPrefix);
  const part: PlacedPart = { id, type, pins };
  return { ok: true, id, circuit: { ...circuit, parts: [...circuit.parts, part], nextId } };
}

function requireType(type: unknown): string {
  if (typeof type !== 'string' || !hasPartDef(type)) {
    throw new Rejection('UNKNOWN_TYPE', `unknown part type: ${JSON.stringify(type)}`);
  }
  return type;
}

function dispatch(circuit: Circuit, cmd: Command): CommandResult {
  switch (cmd.op) {
    case 'place': {
      const def = getPartDef(requireType(cmd.type));
      const fp = footprintAt(circuit.spec, def, boardTerminal(circuit, cmd.at));
      if (!fp.ok) throw new Rejection('BAD_PLACEMENT', fp.reason);
      return addPart(circuit, def.type, fp.pins);
    }
    case 'placeLeads': {
      const def = getPartDef(requireType(cmd.type));
      if (def.leads !== 'flexible') {
        throw new Rejection('BAD_ARGS', `${def.label} has a fixed footprint; use place`);
      }
      const given = Object.keys(cmd.pins ?? {}).sort();
      const wanted = def.pins.map((p) => p.pin).sort();
      if (given.join() !== wanted.join()) {
        throw new Rejection(
          'BAD_ARGS',
          `${def.label} needs pins ${wanted.join(', ')}, got ${given.join(', ') || 'none'}`,
        );
      }
      const pins: Record<string, BoardTerminal> = {};
      for (const p of def.pins) pins[p.pin] = boardTerminal(circuit, cmd.pins[p.pin]);
      return addPart(circuit, def.type, pins);
    }
    case 'wire': {
      const from = boardTerminal(circuit, cmd.from);
      const to = boardTerminal(circuit, cmd.to);
      if (terminalKey(from) === terminalKey(to)) {
        throw new Rejection(
          'BAD_ARGS',
          `a wire needs two different holes, got ${terminalKey(from)} twice`,
        );
      }
      // A pin end goes into the nearest free hole joined to that pin's hole.
      const ends = [cmd.from, cmd.to].map((key, i) => {
        const end = i === 0 ? from : to;
        return key.startsWith('pin:') ? freeHoleJoinedTo(circuit, end) : end;
      }) as [BoardTerminal, BoardTerminal];
      assertFree(circuit, ends);
      const { id, nextId } = allocateId(circuit, 'W');
      const wire = { id, from: ends[0], to: ends[1] };
      return { ok: true, id, circuit: { ...circuit, wires: [...circuit.wires, wire], nextId } };
    }
    case 'power':
    case 'ground': {
      const at = boardTerminal(circuit, cmd.at);
      if (cmd.at.startsWith('pin:')) {
        throw new Rejection('BAD_TERMINAL', `a supply lead goes in a hole, got ${cmd.at}`);
      }
      assertFree(circuit, [at]);
      const { id, nextId } = allocateId(circuit, cmd.op === 'power' ? 'VCC' : 'GND');
      const supply: Supply = { id, kind: cmd.op, at, volts: cmd.op === 'power' ? 5 : 0 };
      return {
        ok: true,
        id,
        circuit: { ...circuit, supplies: [...circuit.supplies, supply], nextId },
      };
    }
    case 'set': {
      const part = findPart(circuit, cmd.id);
      if (!part) throw new Rejection('UNKNOWN_PART', `no part ${JSON.stringify(cmd.id)}`);
      const def = getPartDef(part.type);
      if (def.kind !== 'switch') {
        throw new Rejection('BAD_ARGS', `${part.id} (${def.label}) has no settable state`);
      }
      if (cmd.value !== 0 && cmd.value !== 1) {
        throw new Rejection(
          'BAD_ARGS',
          `switch position must be 0 or 1, got ${JSON.stringify(cmd.value)}`,
        );
      }
      const updated: PlacedPart = { ...part, state: { ...part.state, position: cmd.value } };
      return {
        ok: true,
        id: part.id,
        circuit: { ...circuit, parts: circuit.parts.map((p) => (p.id === part.id ? updated : p)) },
      };
    }
    case 'remove': {
      if (findPart(circuit, cmd.id)) {
        return {
          ok: true,
          id: cmd.id,
          circuit: { ...circuit, parts: circuit.parts.filter((p) => p.id !== cmd.id) },
        };
      }
      if (circuit.wires.some((w) => w.id === cmd.id)) {
        return {
          ok: true,
          id: cmd.id,
          circuit: { ...circuit, wires: circuit.wires.filter((w) => w.id !== cmd.id) },
        };
      }
      if (circuit.supplies.some((x) => x.id === cmd.id)) {
        return {
          ok: true,
          id: cmd.id,
          circuit: { ...circuit, supplies: circuit.supplies.filter((x) => x.id !== cmd.id) },
        };
      }
      throw new Rejection('UNKNOWN_PART', `no part, wire or supply ${JSON.stringify(cmd.id)}`);
    }
    default:
      throw new Rejection('BAD_ARGS', `unknown op ${JSON.stringify((cmd as { op?: unknown }).op)}`);
  }
}

/**
 * The free board terminal nearest to `t` among those the board itself joins
 * to it (its row strip or rail line), for wiring "to a pin": the pin's own
 * hole is taken by the pin, and one lead per hole is the rule.
 */
function freeHoleJoinedTo(circuit: Circuit, t: BoardTerminal): BoardTerminal {
  const key = terminalKey(t);
  const group = boardConnections(circuit.spec).find((g) => g.some((m) => terminalKey(m) === key));
  const occupied = occupancy(circuit);
  const at = terminalPosition(circuit.spec, t);
  const dist = (m: BoardTerminal): number => {
    const p = terminalPosition(circuit.spec, m);
    return Math.hypot(p.x - at.x, p.y - at.y);
  };
  const free = (group ?? []).filter((m) => !occupied.has(terminalKey(m)));
  free.sort((a, b) => dist(a) - dist(b));
  if (!free[0]) throw new Rejection('OCCUPIED', `no free hole left joined to ${key}`);
  return free[0];
}

export function applyCommand(circuit: Circuit, cmd: Command): CommandResult {
  try {
    if (typeof cmd !== 'object' || cmd === null)
      throw new Rejection('BAD_ARGS', 'a command must be an object');
    return dispatch(circuit, cmd);
  } catch (e) {
    if (e instanceof Rejection) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
}
