// The NovaLang bridge, sim side: docs/NOVALANG_BRIDGE.md. Each op is checked,
// then turned into the same SimService requests the UI sends, so scripts and
// the editor share one validation path. Results are plain JSON.

import { isOnBoard } from '../domain/breadboard/spec';
import { parseTerminal, terminalKey, TerminalRefError } from '../domain/breadboard/terminal';
import type { Command } from '../domain/circuit/commands';
import { getPartDef, hasPartDef } from '../domain/parts/registry';
import type { PlacedPart } from '../domain/parts/types';
import {
  BRIDGE_OPS,
  BRIDGE_VERSION,
  BRIDGE_VERSIONS_ACCEPTED,
  MAX_PARTS,
  MAX_WIRES,
  type BridgeErrorCode,
  type BridgeResponse,
} from '../protocol/bridge';
import type { SimMessage, SimRequest, SimResponse } from '../protocol/sim-protocol';
import type { SimService } from './sim-service';

export interface BridgeOutcome {
  readonly response: BridgeResponse;
  /** circuit/frame pushes the UI should see. */
  readonly pushes: readonly SimMessage[];
}

class Refusal extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Resistor values `board.resistor` accepts, and the registry type for each. */
const RESISTORS: Readonly<Record<number, string>> = {
  100: 'resistor-100',
  330: 'resistor',
  1000: 'resistor-1k',
  10000: 'resistor-10k',
};

/** `"7400"`, `"74HC00"` or `"74hc00"` → `chip74hc00`. Breadboard's chips are all 74HC. */
function chipType(name: unknown): string {
  const m = typeof name === 'string' ? /^74(?:hc)?(\d{2})$/i.exec(name) : null;
  const type = m ? `chip74hc${m[1]}` : '';
  if (!hasPartDef(type)) {
    throw new Refusal(
      'UNKNOWN_TYPE',
      `no chip ${JSON.stringify(name)}; try "7400", "7402", "7404" or "7408"`,
    );
  }
  return type;
}

function str(op: string, name: string, v: unknown): string {
  if (typeof v !== 'string')
    throw new Refusal('BAD_ARGS', `${op}: ${name} must be a string, got ${JSON.stringify(v)}`);
  return v;
}

function num(op: string, name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Refusal('BAD_ARGS', `${op}: ${name} must be a number, got ${JSON.stringify(v)}`);
  }
  return v;
}

function arity(op: string, args: readonly unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min} to ${max}`;
    throw new Refusal(
      'BAD_ARGS',
      `${op} takes ${want} argument${max === 1 ? '' : 's'}, got ${args.length}`,
    );
  }
}

/** A part handle: NOVALANG_BRIDGE.md §2. */
function handle(part: PlacedPart): object {
  const pins: Record<string, string> = {};
  const holes: Record<string, string> = {};
  for (const fp of getPartDef(part.type).pins) {
    pins[fp.pin] = terminalKey({ kind: 'pin', part: part.id, pin: fp.pin });
    holes[fp.pin] = terminalKey(part.pins[fp.pin]!);
  }
  return { id: part.id, type: part.type, pins, holes };
}

/** A SimRequest without its envelope, kept as a union. */
type RequestBody = SimRequest extends infer T
  ? T extends unknown
    ? Omit<T, 'v' | 'id'>
    : never
  : never;

export function handleBridge(service: SimService, raw: unknown): BridgeOutcome {
  let id = -1;
  let v = BRIDGE_VERSION;
  const pushes: SimMessage[] = [];

  /** Run one SimService request; collect its pushes; return its result or throw its error. */
  const send = (req: RequestBody): Extract<SimResponse, { ok: true }>['result'] => {
    const out = service.handle({ v: 1, id: 0, ...req });
    const response = out[out.length - 1] as SimResponse;
    pushes.push(...out.slice(0, -1));
    if (!response.ok) {
      const code = response.error.code === 'BAD_REQUEST' ? 'BAD_ARGS' : response.error.code;
      throw new Refusal(code, response.error.message);
    }
    return response.result;
  };
  const command = (cmd: Command): string => send({ kind: 'command', cmd }).id ?? '';
  const part = (pid: string): PlacedPart => service.state.circuit.parts.find((p) => p.id === pid)!;
  const placing = (): void => {
    if (service.state.circuit.parts.length >= MAX_PARTS) {
      throw new Refusal('LIMIT', `a board holds at most ${MAX_PARTS} parts`);
    }
  };

  try {
    const req = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<{
      v: unknown;
      id: unknown;
      op: unknown;
      args: unknown;
    }> | null;
    if (!req || typeof req !== 'object')
      throw new Refusal('BAD_ARGS', 'a bridge request must be an object');
    if (typeof req.id === 'number') id = req.id;
    if (typeof req.v !== 'number' || !BRIDGE_VERSIONS_ACCEPTED.includes(req.v)) {
      throw new Refusal('BAD_ARGS', `unsupported bridge version ${JSON.stringify(req.v)}`);
    }
    v = req.v;
    const op = req.op;
    if (typeof op !== 'string' || !BRIDGE_OPS.includes(op)) {
      throw new Refusal('BAD_ARGS', `unknown op ${JSON.stringify(op)}`);
    }
    if (op === 'board.resistor' && v < 2) {
      throw new Refusal('BAD_ARGS', 'board.resistor needs bridge contract v2');
    }
    const args = Array.isArray(req.args) ? (req.args as unknown[]) : [];
    const result = dispatch(op, args);
    return { response: { v, id, ok: true, result }, pushes };
  } catch (e) {
    const err =
      e instanceof Refusal
        ? { code: e.code, message: e.message }
        : e instanceof SyntaxError
          ? { code: 'BAD_ARGS' as const, message: `malformed request: ${e.message}` }
          : { code: 'INTERNAL' as const, message: e instanceof Error ? e.message : String(e) };
    return { response: { v, id, ok: false, error: err }, pushes };
  }

  function dispatch(op: string, args: readonly unknown[]): unknown {
    switch (op) {
      case 'board.new': {
        arity(op, args, 0, 1);
        const size = args.length === 0 ? 'half' : str(op, 'size', args[0]);
        if (size !== 'half' && size !== 'full') {
          throw new Refusal(
            'BAD_ARGS',
            `board.new: size must be "half" or "full", got ${JSON.stringify(size)}`,
          );
        }
        send({ kind: 'hello', size, preset: 'empty' });
        const spec = service.state.circuit.spec;
        return { size: spec.size, rows: spec.rows, splitRails: spec.splitRails };
      }
      case 'board.switch': {
        arity(op, args, 1);
        placing();
        return handle(
          part(command({ op: 'place', type: 'switch-spdt', at: str(op, 'at', args[0]) })),
        );
      }
      case 'board.led': {
        arity(op, args, 2);
        placing();
        const pins = { anode: str(op, 'anode', args[0]), cathode: str(op, 'cathode', args[1]) };
        return handle(part(command({ op: 'placeLeads', type: 'led-red', pins })));
      }
      case 'board.resistor': {
        arity(op, args, 3);
        placing();
        const ohms = num(op, 'ohms', args[0]);
        const type = RESISTORS[ohms];
        if (!type) {
          throw new Refusal(
            'BAD_ARGS',
            `board.resistor: ohms must be one of ${Object.keys(RESISTORS).join(', ')}, got ${ohms}`,
          );
        }
        const pins = { '1': str(op, 'from', args[1]), '2': str(op, 'to', args[2]) };
        return handle(part(command({ op: 'placeLeads', type, pins })));
      }
      case 'board.chip': {
        arity(op, args, 2);
        placing();
        const type = chipType(args[0]);
        return handle(part(command({ op: 'place', type, at: str(op, 'at', args[1]) })));
      }
      case 'board.wire': {
        arity(op, args, 2);
        if (service.state.circuit.wires.length >= MAX_WIRES) {
          throw new Refusal('LIMIT', `a board holds at most ${MAX_WIRES} wires`);
        }
        const wid = command({
          op: 'wire',
          from: str(op, 'from', args[0]),
          to: str(op, 'to', args[1]),
        });
        const w = service.state.circuit.wires.find((x) => x.id === wid)!;
        return { id: w.id, from: terminalKey(w.from), to: terminalKey(w.to) };
      }
      case 'board.power':
      case 'board.ground': {
        arity(op, args, 1);
        const kind = op === 'board.power' ? 'power' : 'ground';
        const sid = command({ op: kind, at: str(op, 'at', args[0]) });
        const s = service.state.circuit.supplies.find((x) => x.id === sid)!;
        return { id: s.id, at: terminalKey(s.at), volts: s.volts };
      }
      case 'board.set': {
        arity(op, args, 2);
        const pid = str(op, 'part', args[0]);
        command({ op: 'set', id: pid, value: num(op, 'value', args[1]) });
        return { id: pid, position: part(pid).state?.['position'] ?? 0 };
      }
      case 'board.run': {
        arity(op, args, 1);
        return send({ kind: 'run', ms: num(op, 'ms', args[0]) }).time;
      }
      case 'board.step': {
        arity(op, args, 1);
        return send({ kind: 'step', ticks: num(op, 'ticks', args[0]) }).time;
      }
      case 'sim.get': {
        arity(op, args, 1);
        return get(str(op, 'target', args[0]));
      }
      case 'sim.snapshot': {
        arity(op, args, 0);
        const { circuit, result, time } = service.state;
        return {
          time,
          nets: result.nets.map((n) => ({
            id: n.id,
            level: n.level,
            volts: n.volts,
            terminals: n.terminals,
          })),
          parts: [...circuit.parts]
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((p) => ({ id: p.id, type: p.type, state: result.parts[p.id] ?? {} })),
          wires: circuit.wires.map((w) => ({
            id: w.id,
            from: terminalKey(w.from),
            to: terminalKey(w.to),
          })),
          warnings: result.warnings,
        };
      }
      case 'sim.time': {
        arity(op, args, 0);
        return service.state.time;
      }
      default:
        throw new Refusal('BAD_ARGS', `unknown op ${JSON.stringify(op)}`);
    }
  }

  /** sim.get: a TerminalRef key gives its net; a part id gives the part's state. */
  function get(target: string): object {
    const { circuit, result } = service.state;
    if (target.includes(':')) {
      let ref;
      try {
        ref = parseTerminal(target);
      } catch (e) {
        if (e instanceof TerminalRefError) throw new Refusal('BAD_TERMINAL', e.message);
        throw e;
      }
      const known =
        ref.kind === 'pin'
          ? circuit.parts.some((p) => p.id === ref.part && ref.pin in p.pins)
          : isOnBoard(circuit.spec, ref);
      if (!known) throw new Refusal('BAD_TERMINAL', `${target} is not on this board`);
      const net = result.nets.find((n) => n.terminals.includes(target))!;
      return { net: net.id, level: net.level, volts: net.volts };
    }
    const p = circuit.parts.find((x) => x.id === target);
    if (!p) throw new Refusal('UNKNOWN_PART', `no part ${JSON.stringify(target)}`);
    return { id: p.id, type: p.type, state: result.parts[p.id] ?? {} };
  }
}
