// Saves: docs/ARCHITECTURE.md §6. Versioned, declarative JSON. Every connection
// point is a TerminalRef key. Derived data (the netlist) and sim state (levels,
// time, burnt LEDs) are never saved; user-set part state (switch positions) is.
//
// Loading replays the save through applyCommand, the one validation path, so a
// hand-edited or corrupted save is refused with the dispatcher's own message.
// Ids are kept: before each placement the id counter is steered to the saved id.

import { terminalKey, type TerminalKey } from '../breadboard/terminal';
import type { BoardSize } from '../breadboard/spec';
import { getPartDef, hasPartDef } from '../parts/registry';
import { emptyCircuit, type Circuit } from './circuit';
import { applyCommand, type Command } from './commands';

export const SAVE_FORMAT = 'breadboard';
export const SAVE_VERSION = 1;

export interface SavedPart {
  readonly id: string;
  readonly type: string;
  /** Fixed footprints: the hole of the anchor pin (pin 1 of a chip). */
  readonly at?: TerminalKey;
  /** Flexible leads: every pin's hole. */
  readonly pins?: Readonly<Record<string, TerminalKey>>;
  readonly state?: Readonly<Record<string, number>>;
}

export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  readonly version: number;
  readonly board: { readonly size: BoardSize; readonly splitRails: boolean };
  readonly parts: readonly SavedPart[];
  readonly wires: readonly {
    readonly id: string;
    readonly from: TerminalKey;
    readonly to: TerminalKey;
  }[];
  readonly supplies: readonly {
    readonly id: string;
    readonly kind: 'power' | 'ground';
    readonly at: TerminalKey;
    readonly volts: number;
  }[];
  readonly meta?: { readonly title?: string; readonly created?: string };
}

export type LoadResult =
  { readonly ok: true; readonly circuit: Circuit } | { readonly ok: false; readonly error: string };

export function toSave(circuit: Circuit, meta: SaveFile['meta'] = {}): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    board: { size: circuit.spec.size, splitRails: circuit.spec.splitRails },
    parts: circuit.parts.map((p) => {
      const def = getPartDef(p.type);
      const base = { id: p.id, type: p.type, ...(p.state ? { state: p.state } : {}) };
      if (def.leads === 'fixed') return { ...base, at: terminalKey(p.pins[def.pins[0]!.pin]!) };
      const pins: Record<string, TerminalKey> = {};
      for (const fp of def.pins) pins[fp.pin] = terminalKey(p.pins[fp.pin]!);
      return { ...base, pins };
    }),
    wires: circuit.wires.map((w) => ({
      id: w.id,
      from: terminalKey(w.from),
      to: terminalKey(w.to),
    })),
    supplies: circuit.supplies.map((s) => ({
      id: s.id,
      kind: s.kind,
      at: terminalKey(s.at),
      volts: s.volts,
    })),
    meta,
  };
}

/**
 * Upgrades from older save versions, keyed by the version they upgrade from.
 * Empty while v1 is the only version; never reject an old save silently.
 */
const MIGRATIONS: Readonly<
  Record<number, (save: Record<string, unknown>) => Record<string, unknown>>
> = {};

const ID = /^([A-Za-z]+)(\d+)$/;

export function fromSave(raw: unknown): LoadResult {
  try {
    let save = raw as Record<string, unknown> | null;
    if (!save || typeof save !== 'object' || save['format'] !== SAVE_FORMAT) {
      return { ok: false, error: 'not a Breadboard save (missing "format": "breadboard")' };
    }
    let version = save['version'];
    while (typeof version === 'number' && version < SAVE_VERSION && MIGRATIONS[version]) {
      save = MIGRATIONS[version]!(save);
      version = save['version'];
    }
    if (version !== SAVE_VERSION) {
      return {
        ok: false,
        error: `unsupported save version ${JSON.stringify(version)} (this build reads ${SAVE_VERSION})`,
      };
    }
    const s = save as unknown as SaveFile;
    const size = s.board?.size;
    if (size !== 'half' && size !== 'full')
      return { ok: false, error: `bad board size ${JSON.stringify(size)}` };

    let circuit = emptyCircuit(size, { splitRails: s.board.splitRails === true });
    const nextId: Record<string, number> = {};
    /** Apply one command so that it gets exactly `id`. */
    const apply = (what: string, id: string, cmd: Command): void => {
      const m = typeof id === 'string' ? ID.exec(id) : null;
      if (!m) throw new Error(`${what}: bad id ${JSON.stringify(id)}`);
      const [, prefix, n] = m;
      circuit = { ...circuit, nextId: { ...circuit.nextId, [prefix!]: Number(n) } };
      const r = applyCommand(circuit, cmd);
      if (!r.ok) throw new Error(`${what} ${id}: ${r.error.message}`);
      if (r.id !== id) throw new Error(`${what} ${id}: id prefix does not match its type`);
      circuit = r.circuit;
      nextId[prefix!] = Math.max(nextId[prefix!] ?? 1, Number(n) + 1);
    };
    const seen = new Set<string>();
    const unique = (id: string): void => {
      if (seen.has(id)) throw new Error(`duplicate id ${id}`);
      seen.add(id);
    };

    for (const p of s.parts ?? []) {
      unique(p.id);
      if (!hasPartDef(p.type))
        throw new Error(`part ${p.id}: unknown type ${JSON.stringify(p.type)}`);
      const def = getPartDef(p.type);
      if (def.leads === 'fixed') {
        apply('part', p.id, { op: 'place', type: p.type, at: p.at! });
      } else {
        apply('part', p.id, { op: 'placeLeads', type: p.type, pins: p.pins ?? {} });
      }
      const position = p.state?.['position'];
      if (position !== undefined) {
        const r = applyCommand(circuit, { op: 'set', id: p.id, value: position });
        if (!r.ok) throw new Error(`part ${p.id}: ${r.error.message}`);
        circuit = r.circuit;
      }
    }
    for (const w of s.wires ?? []) {
      unique(w.id);
      apply('wire', w.id, { op: 'wire', from: w.from, to: w.to });
    }
    for (const sp of s.supplies ?? []) {
      unique(sp.id);
      if (sp.kind !== 'power' && sp.kind !== 'ground') throw new Error(`supply ${sp.id}: bad kind`);
      apply('supply', sp.id, { op: sp.kind, at: sp.at });
    }
    // Ids are never reused: continue after the highest saved number.
    return { ok: true, circuit: { ...circuit, nextId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
