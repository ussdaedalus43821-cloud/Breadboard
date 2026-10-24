// Stage-1 logic solver: static, combinational, levels only. See
// docs/ARCHITECTURE.md §4a and docs/DECISIONS.md D-016/D-017.
//
//   1. Start from the static netlist (strips, rails, pins-in-holes, wires).
//   2. Join nets through closed switch contacts (ideal conductors).
//   3. Strong drivers: supply leads (and chip outputs from Phase 3). Two
//      different strong levels on one net → X and a SHORT warning.
//   4. Resistors pass a *weak* copy of a strong level to undriven nets. An
//      undriven group that sees both 0 and 1 through resistors → X (a
//      divider; real voltages arrive with Stage 2). Sees nothing → Z.
//   5. LEDs are loads: they never drive either net. Lit = anode 1, cathode 0.
//   6. Warnings: floating chip inputs, unpowered chips, shorts.

import { UnionFind } from '../breadboard/netlist';
import { pin, terminalKey, type TerminalKey, type TerminalRef } from '../breadboard/terminal';
import { circuitNetlist, type Circuit } from '../circuit/circuit';
import { getPartDef } from '../parts/registry';
import type { PlacedPart } from '../parts/types';

export type Level = 0 | 1 | 'Z' | 'X';
export type Strength = 'strong' | 'weak' | 'none';

export interface SolvedNet {
  /** `net:` + the smallest terminal key in the (switch-merged) net. */
  readonly id: string;
  readonly level: Level;
  readonly strength: Strength;
  /** Sorted canonical keys. */
  readonly terminals: readonly TerminalKey[];
}

export type WarningCode = 'FLOATING_INPUT' | 'CHIP_UNPOWERED' | 'SHORT';

export interface SimWarning {
  readonly code: WarningCode;
  readonly message: string;
  /** Terminal keys the warning is about, for highlighting. */
  readonly at: readonly TerminalKey[];
}

/** Observable per-part state. */
export interface PartState {
  readonly lit?: boolean;
  readonly position?: number;
}

export interface SimResult {
  /** Sorted by id. */
  readonly nets: readonly SolvedNet[];
  /** Keyed by part id. */
  readonly parts: Readonly<Record<string, PartState>>;
  /** Sorted by code, then first `at` in natural order (pin 2 before pin 10). */
  readonly warnings: readonly SimWarning[];
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** For human-facing order: pin:U1:2 before pin:U1:10. Fixed locale, so still deterministic. */
const natural = new Intl.Collator('en', { numeric: true }).compare;

export function switchPosition(part: PlacedPart): number {
  return part.state?.['position'] ?? 0;
}

/** Pin pairs a switch currently joins. */
function closedContacts(part: PlacedPart): Array<[string, string]> {
  const position = switchPosition(part);
  switch (part.type) {
    case 'switch-spst':
      return position === 1 ? [['1', '2']] : [];
    case 'switch-spdt':
      return [position === 1 ? ['com', 'b'] : ['com', 'a']];
    default:
      return [];
  }
}

export function solve(circuit: Circuit): SimResult {
  const base = circuitNetlist(circuit);

  // 2. Merge base nets through closed switch contacts.
  const uf = new UnionFind();
  for (const net of base.nets) uf.add(net.id);
  const defs = new Map(circuit.parts.map((p) => [p.id, getPartDef(p.type)]));
  for (const part of circuit.parts) {
    if (defs.get(part.id)!.kind !== 'switch') continue;
    for (const [a, b] of closedContacts(part)) {
      uf.union(base.netOf(pin(part.id, a)), base.netOf(pin(part.id, b)));
    }
  }
  const members = new Map<string, { keys: TerminalKey[]; bases: string[] }>();
  for (const net of base.nets) {
    const root = uf.find(net.id);
    const m = members.get(root) ?? { keys: [], bases: [] };
    m.keys.push(...net.terminals);
    m.bases.push(net.id);
    members.set(root, m);
  }
  const groupOfBase = new Map<string, string>(); // base net id → merged id
  const terminals = new Map<string, TerminalKey[]>(); // merged id → keys
  for (const { keys, bases } of members.values()) {
    keys.sort(byKey);
    const id = `net:${keys[0]!}`;
    terminals.set(id, keys);
    for (const b of bases) groupOfBase.set(b, id);
  }
  const netOf = (ref: TerminalRef): string => groupOfBase.get(base.netOf(ref))!;

  // 3. Strong drivers.
  const strong = new Map<string, Set<0 | 1>>();
  const drive = (net: string, level: 0 | 1): void => {
    const set = strong.get(net) ?? new Set();
    set.add(level);
    strong.set(net, set);
  };
  for (const s of circuit.supplies) drive(netOf(s.at), s.kind === 'power' ? 1 : 0);

  const level = new Map<string, Level>();
  const strength = new Map<string, Strength>();
  const warnings: SimWarning[] = [];
  for (const [net, set] of strong) {
    level.set(net, set.size === 1 ? [...set][0]! : 'X');
    strength.set(net, 'strong');
    if (set.size > 1) {
      const at = circuit.supplies.filter((s) => netOf(s.at) === net).map((s) => terminalKey(s.at));
      warnings.push({
        code: 'SHORT',
        message: `+5 V is shorted to ground (${at.join(', ')})`,
        at: at.sort(byKey),
      });
    }
  }

  // 4. Weak levels through resistors: group undriven nets joined by resistors,
  //    then collect the strong levels each group touches.
  const weak = new UnionFind();
  const edges: Array<[string, string]> = [];
  for (const id of terminals.keys()) if (!strong.has(id)) weak.add(id);
  for (const part of circuit.parts) {
    if (defs.get(part.id)!.kind !== 'resistor') continue;
    const a = netOf(pin(part.id, '1'));
    const b = netOf(pin(part.id, '2'));
    edges.push([a, b]);
    if (weak.has(a) && weak.has(b)) weak.union(a, b);
  }
  const seen = new Map<string, Set<Level>>(); // weak group root → strong levels touched
  for (const [a, b] of edges) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      if (strong.has(from) && weak.has(to)) {
        const root = weak.find(to);
        const set = seen.get(root) ?? new Set<Level>();
        set.add(level.get(from)!);
        seen.set(root, set);
      }
    }
  }
  for (const id of terminals.keys()) {
    if (strong.has(id)) continue;
    const set = seen.get(weak.find(id));
    if (!set) {
      level.set(id, 'Z');
      strength.set(id, 'none');
    } else {
      level.set(id, set.size === 1 ? [...set][0]! : 'X');
      strength.set(id, 'weak');
    }
  }

  const levelAt = (ref: TerminalRef): Level => level.get(netOf(ref))!;

  // 5–6. Part states and warnings.
  const parts: Record<string, PartState> = {};
  for (const part of circuit.parts) {
    const def = defs.get(part.id)!;
    if (def.kind === 'led') {
      parts[part.id] = {
        lit: levelAt(pin(part.id, 'anode')) === 1 && levelAt(pin(part.id, 'cathode')) === 0,
      };
    } else if (def.kind === 'switch') {
      parts[part.id] = { position: switchPosition(part) };
    } else {
      parts[part.id] = {};
    }

    if (def.kind !== 'chip') continue;
    for (const fp of def.pins) {
      const ref = pin(part.id, fp.pin);
      const key = terminalKey(ref);
      const lv = levelAt(ref);
      const label = `${part.id} pin ${fp.pin}${fp.name ? ` (${fp.name})` : ''}`;
      if (fp.role === 'input' && lv === 'Z') {
        warnings.push({
          code: 'FLOATING_INPUT',
          message: `${label} is floating: connect it to a driven net`,
          at: [key],
        });
      }
      if ((fp.role === 'power' && lv !== 1) || (fp.role === 'ground' && lv !== 0)) {
        const want = fp.role === 'power' ? '+5 V (1)' : 'ground (0)';
        warnings.push({
          code: 'CHIP_UNPOWERED',
          message: `${label} should be at ${want} but is ${lv}`,
          at: [key],
        });
      }
    }
  }

  const nets: SolvedNet[] = [...terminals.entries()]
    .map(([id, keys]) => ({
      id,
      level: level.get(id)!,
      strength: strength.get(id)!,
      terminals: keys,
    }))
    .sort((a, b) => byKey(a.id, b.id));
  warnings.sort((a, b) => byKey(a.code, b.code) || natural(a.at[0] ?? '', b.at[0] ?? ''));
  return { nets, parts, warnings };
}
