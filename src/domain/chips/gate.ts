// 74xx logic chips as data. One builder (`gateChip`) turns a pinout table and
// a gate function into a PartDef with ChipLogic attached. See
// docs/ARCHITECTURE.md §4b.

import type { Level } from '../sim/levels';
import type { PartDef, PinFootprint, PinRole } from '../parts/types';

/** A gate's output for its input levels. Floating or unknown inputs give X. */
export type GateFn = (inputs: readonly Level[]) => Level;

const known = (v: Level): v is 0 | 1 => v === 0 || v === 1;

export const AND: GateFn = (ins) => (ins.includes(0) ? 0 : ins.every((v) => v === 1) ? 1 : 'X');
export const OR: GateFn = (ins) => (ins.includes(1) ? 1 : ins.every((v) => v === 0) ? 0 : 'X');
const invert = (v: Level): Level => (v === 0 ? 1 : v === 1 ? 0 : 'X');
export const NAND: GateFn = (ins) => invert(AND(ins));
export const NOR: GateFn = (ins) => invert(OR(ins));
export const NOT: GateFn = ([a]) => invert(a ?? 'X');
export const XOR: GateFn = (ins) =>
  ins.every(known) ? ((ins.filter((v) => v === 1).length % 2) as 0 | 1) : 'X';

/**
 * One functional unit of a chip: a gate, a flip-flop, a decoder. Pure: given
 * the levels on its input pins and its own state, it returns the levels its
 * output pins should drive and its next state. Stateless gates ignore state.
 * The engine evaluates it after every solve (so `eval` must be idempotent for
 * unchanged inputs: an edge is a change, seen once) and applies the outputs
 * `delayTicks` later.
 */
export interface Block<S = unknown> {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** State at power-on. */
  readonly initial: S;
  eval(
    inputs: Readonly<Record<string, Level>>,
    state: S,
  ): { readonly outputs: Readonly<Record<string, Level>>; readonly state: S };
}

/** A combinational gate as a Block. */
export function gate(inputs: readonly string[], output: string, fn: GateFn): Block<null> {
  return {
    inputs,
    outputs: [output],
    initial: null,
    eval: (levels) => ({
      outputs: { [output]: fn(inputs.map((p) => levels[p] ?? 'Z')) },
      state: null,
    }),
  };
}

/** How a chip computes: its blocks, supply pins, and propagation delay. */
export interface ChipLogic {
  readonly blocks: readonly Block[];
  readonly vcc: string;
  readonly gnd: string;
  /**
   * Propagation delay in sim ticks (1 tick = 1 ms). A real 74HC00 switches in
   * about 8 ns; one tick is the smallest delay the 1 kHz sim can show (D-021).
   */
  readonly delayTicks: number;
}

/** DIP package footprint, pin 1 at the anchor. Pins 1…n/2 run along the anchor's
 *  column toward higher rows; the rest come back along the column 0.3" away (dy = -3,
 *  across the channel), so numbering is counterclockwise seen from above. */
export function dipFootprint(pinCount: number): PinFootprint[] {
  if (pinCount < 4 || pinCount % 2 !== 0) throw new RangeError(`bad DIP pin count: ${pinCount}`);
  const side = pinCount / 2;
  const pins: PinFootprint[] = [];
  for (let n = 1; n <= side; n++) pins.push({ pin: String(n), dx: n - 1, dy: 0 });
  for (let n = side + 1; n <= pinCount; n++) {
    pins.push({ pin: String(n), dx: pinCount - n, dy: -3 });
  }
  return pins;
}

/** A DIP-14 pinout: each gate as [inputs..., output], by pin number. VCC 14, GND 7. */
export type Pinout14 = readonly (readonly number[])[];

/** Quad 2-input gate: 7400 (NAND), 7408 (AND), 7432 (OR), 7486 (XOR). */
export const QUAD_2_INPUT: Pinout14 = [
  [1, 2, 3],
  [4, 5, 6],
  [9, 10, 8],
  [12, 13, 11],
];
/** Quad 2-input NOR, 7402: outputs come first on each side. */
export const QUAD_2_INPUT_NOR: Pinout14 = [
  [2, 3, 1],
  [5, 6, 4],
  [8, 9, 10],
  [11, 12, 13],
];
/** Hex inverter, 7404. */
export const HEX_INVERTER: Pinout14 = [
  [1, 2],
  [3, 4],
  [5, 6],
  [9, 8],
  [11, 10],
  [13, 12],
];

export interface GateChipSpec {
  /** Registry type, e.g. `chip74hc00`. */
  readonly type: string;
  /** Part number printed on the package, e.g. `74HC00`. */
  readonly part: string;
  readonly label: string;
  readonly pinout: Pinout14;
  readonly fn: GateFn;
  readonly delayTicks?: number;
}

/** Build a 14-pin gate chip's PartDef (footprint, pin roles and names, logic). */
export interface DipChipSpec {
  readonly type: string;
  readonly part: string;
  readonly label: string;
  readonly pinCount: number;
  /** Every pin: role and datasheet name. */
  readonly pins: Readonly<Record<string, readonly [PinRole, string]>>;
  readonly blocks: readonly Block[];
  readonly vcc: string;
  readonly gnd: string;
  readonly delayTicks?: number;
}

/** Build any DIP logic chip from a pin table and its blocks. */
export function dipChip(spec: DipChipSpec): PartDef {
  const named = Object.keys(spec.pins);
  if (named.length !== spec.pinCount) {
    throw new Error(`${spec.part}: pin table covers ${named.length} of ${spec.pinCount} pins`);
  }
  for (const b of spec.blocks) {
    for (const p of [...b.inputs, ...b.outputs]) {
      if (!spec.pins[p]) throw new Error(`${spec.part}: block uses unknown pin ${p}`);
    }
  }
  return {
    type: spec.type,
    kind: 'chip',
    label: spec.label,
    idPrefix: 'U',
    pins: dipFootprint(spec.pinCount).map((p) => {
      const [role, name] = spec.pins[p.pin]!;
      return { ...p, role, name };
    }),
    leads: 'fixed',
    anchorColumns: ['e'],
    props: { part: spec.part, vccPin: spec.vcc, gndPin: spec.gnd },
    logic: { blocks: spec.blocks, vcc: spec.vcc, gnd: spec.gnd, delayTicks: spec.delayTicks ?? 1 },
  };
}

/** Build a 14-pin gate chip (VCC 14, GND 7) from its pinout table and gate function. */
export function gateChip(spec: GateChipSpec): PartDef {
  const pins: Record<string, readonly [PinRole, string]> = {
    '7': ['ground', 'GND'],
    '14': ['power', 'VCC'],
  };
  const blocks = spec.pinout.map((row, i) => {
    const n = i + 1;
    const inputs = row.slice(0, -1).map(String);
    const output = String(row[row.length - 1]);
    const letters = inputs.length === 1 ? ['A'] : ['A', 'B', 'C', 'D'];
    inputs.forEach((p, k) => (pins[p] = ['input', `${n}${letters[k]}`]));
    pins[output] = ['output', `${n}Y`];
    return gate(inputs, output, spec.fn);
  });
  if (Object.keys(pins).length !== 14)
    throw new Error(`${spec.part}: pinout does not cover 14 pins`);
  return dipChip({ ...spec, pinCount: 14, pins, blocks, vcc: '14', gnd: '7' });
}
