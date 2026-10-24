// Stage-2 electrical solver: node voltages and branch currents for one instant,
// then logic levels read from the voltages. See docs/ARCHITECTURE.md §4a/§4c.
//
//   1. Start from the static netlist (strips, rails, pins-in-holes, wires) and
//      join nets through closed switch contacts (ideal conductors).
//   2. Elements: drivers (bench-supply leads and chip outputs) are voltage
//      sources behind a series resistance; resistors are conductances; LEDs
//      are piecewise-linear diodes (off, or forward volts + series ohms).
//      Burnt LEDs are open circuits. Chip inputs draw nothing.
//   3. Nodal analysis over the nets that touch an element, iterating LED
//      on/off states until they agree with the voltages.
//   4. Levels: a net with no driver and no resistor path to one is Z. Otherwise
//      ≥ V_IH reads 1, ≤ V_IL reads 0, between is X (and a net an X output
//      drives is X).
//   5. Warnings: floating inputs, unpowered chips, supply shorts, output
//      contention and overload, LED over-current.

import { UnionFind } from '../breadboard/netlist';
import {
  parseTerminal,
  pin,
  terminalKey,
  type TerminalKey,
  type TerminalRef,
} from '../breadboard/terminal';
import { circuitNetlist, type Circuit } from '../circuit/circuit';
import { getPartDef } from '../parts/registry';
import type { PartDef, PlacedPart } from '../parts/types';
import {
  GMIN_SIEMENS,
  HC_OUTPUT_MAX_MILLIAMPS,
  HC_OUTPUT_OHMS,
  LED_LIT_MILLIAMPS,
  LED_OFF_SIEMENS,
  SUPPLY_LIMIT_AMPS,
  SUPPLY_OHMS,
  SUPPLY_VOLTS,
  UNKNOWN_OUTPUT_VOLTS,
  V_IH,
  V_IL,
} from './electrical';
import type { Level } from './levels';
import { solveLinear } from './mna';

export type { Level } from './levels';

/** strong: a driver is on the net; weak: reached through resistors; none: floating. */
export type Strength = 'strong' | 'weak' | 'none';

export interface SolvedNet {
  /** `net:` + the smallest terminal key in the (switch-merged) net. */
  readonly id: string;
  readonly level: Level;
  readonly strength: Strength;
  /** Node voltage; null when the net is floating. */
  readonly volts: number | null;
  /** Sorted canonical keys. */
  readonly terminals: readonly TerminalKey[];
}

export type WarningCode =
  | 'FLOATING_INPUT'
  | 'CHIP_UNPOWERED'
  | 'SHORT'
  | 'CONTENTION'
  | 'OUTPUT_OVERLOAD'
  | 'OVERCURRENT'
  | 'LED_BURNT';

export interface SimWarning {
  readonly code: WarningCode;
  readonly message: string;
  /** Terminal keys the warning is about, for highlighting. */
  readonly at: readonly TerminalKey[];
}

/** Observable per-part state. */
export interface PartState {
  readonly lit?: boolean;
  /** LED glow, 0…1 of its rated current. */
  readonly brightness?: number;
  /** Current through the part (LED anode→cathode, resistor pin 1→2), mA. */
  readonly milliamps?: number;
  /** LED destroyed by over-current; open circuit until replaced. */
  readonly burnt?: boolean;
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

/** Levels chip outputs are currently driving, by pin key. `Z` (or absent) drives nothing. */
export type OutputLevels = ReadonlyMap<TerminalKey, Level>;

/** LEDs destroyed earlier, by part id, with the current that killed them (mA). */
export type BurntLeds = ReadonlyMap<string, number>;

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** For human-facing order: pin:U1:2 before pin:U1:10. Fixed locale, so still deterministic. */
const natural = new Intl.Collator('en', { numeric: true }).compare;
const mA = (amps: number): string => `${(amps * 1000).toFixed(amps < 0.1 ? 1 : 0)} mA`;

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

interface Driver {
  readonly net: string;
  readonly volts: number;
  readonly ohms: number;
  readonly level: Level;
  /** Terminal key: the supply's hole or the output pin. */
  readonly key: string;
  readonly label: string;
  readonly kind: 'supply' | 'output';
}

interface Led {
  readonly part: PlacedPart;
  readonly def: PartDef;
  readonly a: string;
  readonly k: string;
  readonly vf: number;
  readonly rs: number;
  on: boolean;
}

interface Resistor {
  readonly part: PlacedPart;
  readonly a: string;
  readonly b: string;
  readonly ohms: number;
}

export function solve(
  circuit: Circuit,
  outputs: OutputLevels = new Map(),
  burnt: BurntLeds = new Map(),
): SimResult {
  const base = circuitNetlist(circuit);
  const defs = new Map(circuit.parts.map((p) => [p.id, getPartDef(p.type)]));

  // 1. Merge base nets through closed switch contacts.
  const uf = new UnionFind();
  for (const net of base.nets) uf.add(net.id);
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

  // 2. Elements.
  const drivers: Driver[] = [];
  for (const s of circuit.supplies) {
    const high = s.kind === 'power';
    drivers.push({
      net: netOf(s.at),
      volts: high ? SUPPLY_VOLTS : 0,
      ohms: SUPPLY_OHMS,
      level: high ? 1 : 0,
      key: terminalKey(s.at),
      label: s.id,
      kind: 'supply',
    });
  }
  const pinLabel = (part: string, name: string): string => {
    const fp = defs.get(part)?.pins.find((p) => p.pin === name);
    return `${part} pin ${name}${fp?.name ? ` (${fp.name})` : ''}`;
  };
  for (const [key, lv] of outputs) {
    if (lv === 'Z') continue;
    const ref = parseTerminal(key);
    if (ref.kind !== 'pin' || !base.has(ref)) continue;
    drivers.push({
      net: netOf(ref),
      volts: lv === 1 ? SUPPLY_VOLTS : lv === 0 ? 0 : UNKNOWN_OUTPUT_VOLTS,
      ohms: HC_OUTPUT_OHMS,
      level: lv,
      key,
      label: pinLabel(ref.part, ref.pin),
      kind: 'output',
    });
  }
  const resistors: Resistor[] = [];
  const leds: Led[] = [];
  for (const part of circuit.parts) {
    const def = defs.get(part.id)!;
    if (def.kind === 'resistor') {
      resistors.push({
        part,
        a: netOf(pin(part.id, '1')),
        b: netOf(pin(part.id, '2')),
        ohms: Number(def.props['ohms']),
      });
    } else if (def.kind === 'led' && !burnt.has(part.id)) {
      leds.push({
        part,
        def,
        a: netOf(pin(part.id, 'anode')),
        k: netOf(pin(part.id, 'cathode')),
        vf: Number(def.props['forwardVolts']),
        rs: Number(def.props['seriesOhms']),
        on: false,
      });
    }
  }

  // 3. Nodal analysis over the nets any element touches.
  const index = new Map<string, number>();
  const node = (net: string): number => {
    let i = index.get(net);
    if (i === undefined) index.set(net, (i = index.size));
    return i;
  };
  for (const d of drivers) node(d.net);
  for (const r of resistors) {
    node(r.a);
    node(r.b);
  }
  for (const l of leds) {
    node(l.a);
    node(l.k);
  }
  const n = index.size;

  let volts = new Array<number>(n).fill(0);
  const vOf = (net: string): number => {
    const i = index.get(net);
    return i === undefined ? 0 : volts[i]!;
  };
  const ledAmps = (l: Led): number => {
    const vd = vOf(l.a) - vOf(l.k);
    return l.on ? (vd - l.vf) / l.rs : vd * LED_OFF_SIEMENS;
  };

  if (n > 0) {
    for (let iter = 0; iter < 50; iter++) {
      const g = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const rhs = new Array<number>(n).fill(0);
      const conduct = (a: number, b: number, s: number): void => {
        g[a]![a]! += s;
        g[b]![b]! += s;
        g[a]![b]! -= s;
        g[b]![a]! -= s;
      };
      for (let i = 0; i < n; i++) g[i]![i]! += GMIN_SIEMENS;
      for (const d of drivers) {
        const i = index.get(d.net)!;
        g[i]![i]! += 1 / d.ohms;
        rhs[i]! += d.volts / d.ohms;
      }
      for (const r of resistors) conduct(index.get(r.a)!, index.get(r.b)!, 1 / r.ohms);
      for (const l of leds) {
        const a = index.get(l.a)!;
        const k = index.get(l.k)!;
        if (!l.on) {
          conduct(a, k, LED_OFF_SIEMENS);
          continue;
        }
        // I(a→k) = (Va − Vk − Vf) / Rs: a conductance plus a constant current Vf/Rs from k to a.
        conduct(a, k, 1 / l.rs);
        rhs[a]! += l.vf / l.rs;
        rhs[k]! -= l.vf / l.rs;
      }
      volts = solveLinear(g, rhs);

      let changed = false;
      for (const l of leds) {
        const vd = vOf(l.a) - vOf(l.k);
        const next = l.on ? (vd - l.vf) / l.rs > 0 : vd > l.vf;
        if (next !== l.on) {
          l.on = next;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // 4. Strength (topology) and level (voltage).
  const strength = new Map<string, Strength>();
  const driven = new Set(drivers.map((d) => d.net));
  const reach = new UnionFind();
  for (const id of terminals.keys()) reach.add(id);
  for (const r of resistors) reach.union(r.a, r.b);
  const reachesDriver = new Set([...driven].map((net) => reach.find(net)));
  for (const id of terminals.keys()) {
    strength.set(
      id,
      driven.has(id) ? 'strong' : reachesDriver.has(reach.find(id)) ? 'weak' : 'none',
    );
  }
  const unknownNets = new Set(drivers.filter((d) => d.level === 'X').map((d) => d.net));
  const level = new Map<string, Level>();
  for (const id of terminals.keys()) {
    if (strength.get(id) === 'none') level.set(id, 'Z');
    else if (unknownNets.has(id)) level.set(id, 'X');
    else {
      const v = vOf(id);
      level.set(id, v >= V_IH ? 1 : v <= V_IL ? 0 : 'X');
    }
  }
  const levelAt = (ref: TerminalRef): Level => level.get(netOf(ref))!;

  // 5. Part states and warnings.
  const warnings: SimWarning[] = [];
  const parts: Record<string, PartState> = {};
  const ledByPart = new Map(leds.map((l) => [l.part.id, l]));
  const resistorByPart = new Map(resistors.map((r) => [r.part.id, r]));

  for (const part of circuit.parts) {
    const def = defs.get(part.id)!;
    const pinKey = (name: string): string => terminalKey(pin(part.id, name));
    if (def.kind === 'led') {
      const killed = burnt.get(part.id);
      if (killed !== undefined) {
        parts[part.id] = { lit: false, brightness: 0, milliamps: 0, burnt: true };
        warnings.push({
          code: 'LED_BURNT',
          message: `${part.id} burned out: current limit exceeded (${killed.toFixed(0)} mA through it, rated ${def.props['maxMilliamps']} mA). Add a series resistor, then replace the LED`,
          at: [pinKey('anode'), pinKey('cathode')],
        });
        continue;
      }
      const amps = ledAmps(ledByPart.get(part.id)!);
      const milliamps = Math.max(0, amps * 1000);
      const rated = Number(def.props['maxMilliamps']);
      parts[part.id] = {
        lit: milliamps >= LED_LIT_MILLIAMPS,
        brightness: Math.min(1, milliamps / rated),
        milliamps: round(milliamps),
        burnt: false,
      };
      if (milliamps > rated) {
        warnings.push({
          code: 'OVERCURRENT',
          message: `${part.id} carries ${milliamps.toFixed(0)} mA, over its ${rated} mA rating: use a larger series resistor`,
          at: [pinKey('anode'), pinKey('cathode')],
        });
      }
    } else if (def.kind === 'resistor') {
      const r = resistorByPart.get(part.id)!;
      parts[part.id] = { milliamps: round(((vOf(r.a) - vOf(r.b)) / r.ohms) * 1000) };
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
      const label = pinLabel(part.id, fp.pin);
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

  // Driver currents: positive = sourcing into the net.
  const amps = (d: Driver): number => (d.volts - vOf(d.net)) / d.ohms;
  const byNet = new Map<string, Driver[]>();
  for (const d of drivers) byNet.set(d.net, [...(byNet.get(d.net) ?? []), d]);
  for (const list of byNet.values()) {
    const supplies = list.filter(
      (d) => d.kind === 'supply' && Math.abs(amps(d)) > SUPPLY_LIMIT_AMPS,
    );
    if (supplies.length > 0) {
      const at = supplies.map((d) => d.key).sort(natural);
      warnings.push({
        code: 'SHORT',
        message: `+5 V is shorted to ground: bench supply current limit (${SUPPLY_LIMIT_AMPS} A) exceeded at ${at.join(', ')}`,
        at,
      });
    }
    const hot = list.filter(
      (d) =>
        d.kind === 'output' &&
        d.level !== 'X' &&
        Math.abs(amps(d)) * 1000 > HC_OUTPUT_MAX_MILLIAMPS,
    );
    if (hot.length === 0) continue;
    const opposing = list.filter((d) => d.level !== 'X' && hot.some((h) => h.level !== d.level));
    if (opposing.length > 0) {
      const all = [...new Set([...hot, ...opposing])].sort((a, b) => natural(a.key, b.key));
      const worst = Math.max(...hot.map((d) => Math.abs(amps(d))));
      warnings.push({
        code: 'CONTENTION',
        message: `outputs fight over one net: ${all
          .map((d) => `${d.label} drives ${d.level === 1 ? 'high' : 'low'}`)
          .join(', ')}; ${mA(worst)} flows (74HC limit ${HC_OUTPUT_MAX_MILLIAMPS} mA per output)`,
        at: all.map((d) => d.key),
      });
    } else {
      for (const d of hot) {
        warnings.push({
          code: 'OUTPUT_OVERLOAD',
          message: `${d.label} ${amps(d) > 0 ? 'sources' : 'sinks'} ${mA(Math.abs(amps(d)))}, over the 74HC limit of ${HC_OUTPUT_MAX_MILLIAMPS} mA: add a series resistor`,
          at: [d.key],
        });
      }
    }
  }

  const nets: SolvedNet[] = [...terminals.entries()]
    .map(([id, keys]) => ({
      id,
      level: level.get(id)!,
      strength: strength.get(id)!,
      volts: strength.get(id) === 'none' ? null : round(vOf(id)),
      terminals: keys,
    }))
    .sort((a, b) => byKey(a.id, b.id));
  warnings.sort((a, b) => byKey(a.code, b.code) || natural(a.at[0] ?? '', b.at[0] ?? ''));
  return { nets, parts, warnings };
}

/** Three decimals: enough for display, and keeps frames stable against float noise. */
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** LEDs whose current in `result` exceeds their burn-out limit, with that current (mA). */
export function overdrivenLeds(circuit: Circuit, result: SimResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of circuit.parts) {
    const def = getPartDef(part.type);
    if (def.kind !== 'led') continue;
    const s = result.parts[part.id];
    if (!s || s.burnt) continue;
    if ((s.milliamps ?? 0) > Number(def.props['burnMilliamps'])) out.set(part.id, s.milliamps!);
  }
  return out;
}
