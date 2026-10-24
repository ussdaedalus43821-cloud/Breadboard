// Chips with memory: the 74HC74 dual D flip-flop and the 74HC4511 BCD to
// 7-segment latch/decoder/driver. Both are blocks with state (gate.ts).

import type { Level } from '../sim/levels';
import type { PartDef, PinRole } from '../parts/types';
import { dipChip, type Block } from './gate';

const bit = (v: Level | undefined): v is 0 | 1 => v === 0 || v === 1;
const invert = (v: Level): Level => (v === 0 ? 1 : v === 1 ? 0 : 'X');

export interface FlipFlopState {
  /** Stored Q. Flip-flops power up cleared (D-040). */
  readonly q: Level;
  /** CLK level at the last evaluation, for edge detection; null before the first. */
  readonly clk: Level | null;
}

export interface FlipFlopPins {
  readonly d: string;
  readonly clk: string;
  /** Active-low asynchronous preset. */
  readonly pre: string;
  /** Active-low asynchronous clear. */
  readonly clr: string;
  readonly q: string;
  readonly qn: string;
}

/**
 * Positive-edge-triggered D flip-flop with active-low asynchronous preset and
 * clear, as in the 74HC74:
 *
 *   PRE' CLR' CLK  D   | Q   Q'
 *    0    1    x   x   | 1   0
 *    1    0    x   x   | 0   1
 *    0    0    x   x   | 1   1    (both forced high; Q is undefined once released)
 *    1    1    ↑   D   | D   D'
 *    1    1  else  x   | Q   Q'   (held: a steady or falling CLK changes nothing)
 *    Z/X on PRE' or CLR'  | Q   Q'   (held, clock ignored: see D-040)
 *
 * The hold on an unknown PRE'/CLR' matters at power-up: the sim's outputs
 * start undriven for one tick, and a reset loop (NAND of two Qs into CLR')
 * would otherwise lock every flip-flop at X. Real parts settle in nanoseconds.
 */
export function dFlipFlop(p: FlipFlopPins): Block<FlipFlopState> {
  return {
    inputs: [p.d, p.clk, p.pre, p.clr],
    outputs: [p.q, p.qn],
    initial: { q: 0, clk: null },
    eval(levels, state) {
      const pre = levels[p.pre];
      const clr = levels[p.clr];
      const clk = levels[p.clk] ?? 'Z';
      const d = levels[p.d];
      let q = state.q;
      if (pre === 0 && clr === 0) {
        return { outputs: { [p.q]: 1, [p.qn]: 1 }, state: { q: 'X', clk } };
      }
      if (pre === 0) q = 1;
      else if (clr === 0) q = 0;
      else if (!bit(pre) || !bit(clr)) {
        // Floating or unknown PRE'/CLR': hold, and ignore the clock (D-040).
      } else if (state.clk === 0 && clk === 1) q = bit(d) ? d : 'X'; // the rising edge
      return { outputs: { [p.q]: q, [p.qn]: invert(q) }, state: { q, clk } };
    },
  };
}

/** 74HC74 pinout: flip-flop 1 on pins 1–6, flip-flop 2 on pins 8–13. */
const HC74_PINS: Readonly<Record<string, readonly [PinRole, string]>> = {
  '1': ['input', "1CLR'"],
  '2': ['input', '1D'],
  '3': ['input', '1CLK'],
  '4': ['input', "1PRE'"],
  '5': ['output', '1Q'],
  '6': ['output', "1Q'"],
  '7': ['ground', 'GND'],
  '8': ['output', "2Q'"],
  '9': ['output', '2Q'],
  '10': ['input', "2PRE'"],
  '11': ['input', '2CLK'],
  '12': ['input', '2D'],
  '13': ['input', "2CLR'"],
  '14': ['power', 'VCC'],
};

export const CHIP_74HC74: PartDef = dipChip({
  type: 'chip74hc74',
  part: '74HC74',
  label: '74HC74 dual D flip-flop',
  pinCount: 14,
  pins: HC74_PINS,
  blocks: [
    dFlipFlop({ clr: '1', d: '2', clk: '3', pre: '4', q: '5', qn: '6' }),
    dFlipFlop({ clr: '13', d: '12', clk: '11', pre: '10', q: '9', qn: '8' }),
  ],
  vcc: '14',
  gnd: '7',
});

/** Segments a–g lit for each BCD digit, per the HC4511 datasheet (tailless 6 and 9). */
export const SEGMENTS_FOR_DIGIT: readonly string[] = [
  'abcdef', // 0
  'bc', // 1
  'abdeg', // 2
  'abcdg', // 3
  'bcfg', // 4
  'acdfg', // 5
  'cdefg', // 6
  'abc', // 7
  'abcdefg', // 8
  'abcfg', // 9
];

export interface DecoderState {
  /** The latched BCD code (0–15), 'X' if unknown, null before the first evaluation. */
  readonly code: number | 'X' | null;
}

const SEGMENT_PINS = { a: '13', b: '12', c: '11', d: '10', e: '9', f: '15', g: '14' } as const;

/**
 * 74HC4511 BCD to 7-segment latch/decoder/driver (common-cathode displays):
 * LT' low lights every segment; else BL' low blanks; else LE low passes the
 * BCD inputs through and LE high holds the last code. Codes 10–15 blank.
 */
const decoder4511: Block<DecoderState> = {
  inputs: ['7', '1', '2', '6', '3', '4', '5'], // A B C D, LT', BL', LE
  outputs: Object.values(SEGMENT_PINS),
  initial: { code: null },
  eval(levels, state) {
    const bits = ['7', '1', '2', '6'].map((p) => levels[p]);
    const now = bits.every(bit)
      ? bits.reduce<number>((n, b, i) => n + (b as number) * 2 ** i, 0)
      : 'X';
    const le = levels['5'];
    const code = le === 0 || state.code === null ? now : le === 1 ? state.code : 'X';
    const lt = levels['3'];
    const bl = levels['4'];
    const all = (v: Level) => Object.fromEntries(Object.values(SEGMENT_PINS).map((p) => [p, v]));
    let outputs: Record<string, Level>;
    if (lt === 0) outputs = all(1);
    else if (!bit(lt)) outputs = all('X');
    else if (bl === 0) outputs = all(0);
    else if (!bit(bl) || code === 'X') outputs = all('X');
    else {
      const lit = SEGMENTS_FOR_DIGIT[code] ?? ''; // 10–15 blank
      outputs = Object.fromEntries(
        Object.entries(SEGMENT_PINS).map(([seg, p]) => [p, lit.includes(seg) ? 1 : 0]),
      );
    }
    return { outputs, state: { code } };
  },
};

export const CHIP_74HC4511: PartDef = dipChip({
  type: 'chip74hc4511',
  part: '74HC4511',
  label: '74HC4511 BCD to 7-segment decoder',
  pinCount: 16,
  pins: {
    '1': ['input', 'B'],
    '2': ['input', 'C'],
    '3': ['input', "LT'"],
    '4': ['input', "BL'"],
    '5': ['input', 'LE'],
    '6': ['input', 'D'],
    '7': ['input', 'A'],
    '8': ['ground', 'GND'],
    '9': ['output', 'e'],
    '10': ['output', 'd'],
    '11': ['output', 'c'],
    '12': ['output', 'b'],
    '13': ['output', 'a'],
    '14': ['output', 'g'],
    '15': ['output', 'f'],
    '16': ['power', 'VCC'],
  },
  blocks: [decoder4511],
  vcc: '16',
  gnd: '8',
});
