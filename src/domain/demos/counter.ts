// Sequential demos: a toggling D flip-flop, and a decade counter on a 7-segment
// display. Both use only parts from the palette and are clocked by a switch.

import { boardSpec, terminalPosition, type BoardSize } from '../breadboard/spec';
import { pin, rail, terminalKey, type RailId, type TerminalKey } from '../breadboard/terminal';
import type { Command } from '../circuit/commands';
import type { Demo } from './half-adder';

const p = (part: string, n: number | string): TerminalKey => terminalKey(pin(part, String(n)));
const place = (type: string, at: string): Command => ({ op: 'place', type, at });
const leads = (type: string, from: string, to: string): Command => ({
  op: 'placeLeads',
  type,
  pins: type.startsWith('led') ? { anode: from, cathode: to } : { '1': from, '2': to },
});

/**
 * Hands out rail holes near a given row, never the same one twice, so wires to
 * the rails stay short and readable.
 */
function railHoles(size: BoardSize) {
  const spec = boardSpec(size);
  const used = new Set<string>(['top+:1', 'top-:1', 'bottom+:1', 'bottom-:1']); // the bench leads
  return (r: RailId, row: number): TerminalKey => {
    const target = row - 1;
    let best = 0;
    let bestDist = Infinity;
    for (let k = 1; k <= spec.railHolesPerLine; k++) {
      if (used.has(`${r}:${k}`)) continue;
      const d = Math.abs(terminalPosition(spec, rail(r, k)).x - target);
      if (d < bestDist) [best, bestDist] = [k, d];
    }
    used.add(`${r}:${best}`);
    return terminalKey(rail(r, best));
  };
}

/** A powered 74HC74 at e10; SW1 (with a 10 kΩ pull-down) clocks flip-flop 1, whose Q' feeds its D. */
function flipFlopDemo(): Demo {
  const r = railHoles('half');
  const w = (from: string, to: string): Command => ({ op: 'wire', from, to });
  return {
    title: 'D flip-flop (74HC74) toggled by a switch',
    inputs: { CLK: 'SW1' },
    outputs: { Q: 'D1' },
    commands: [
      place('chip74hc74', 'hole:e10'), // U1
      w(p('U1', 14), r('top+', 10)),
      w(p('U1', 7), r('bottom-', 16)),
      w(p('U1', 1), r('bottom+', 10)), // 1CLR' high
      w(p('U1', 4), r('bottom+', 13)), // 1PRE' high
      w(p('U1', 6), p('U1', 2)), // 1D = 1Q': toggle on each rising edge
      // Flip-flop 2 unused: tie its inputs.
      w(p('U1', 13), r('top+', 11)),
      w(p('U1', 10), r('top+', 14)),
      w(p('U1', 11), r('top-', 13)),
      w(p('U1', 12), r('top-', 12)),
      // The clock: SW1 to +5 V, 10 kΩ pull-down, into 1CLK.
      place('switch-spst', 'hole:a3'), // SW1: a3 – a5
      w('hole:b3', r('bottom+', 3)),
      leads('resistor-10k', 'hole:c5', r('bottom-', 5)),
      w('hole:d5', p('U1', 3)),
      // 1Q → 330 Ω → LED → ground.
      place('led-red', 'hole:a24'), // D1: anode a24, cathode a25
      leads('resistor', p('U1', 5), 'hole:c24'),
      w('hole:b25', r('bottom-', 25)),
    ],
  };
}

/**
 * Decade counter, full-size board: four 74HC74 flip-flops as a ripple counter
 * (each stage's Q' feeds its own D and clocks the next stage), reset at 10 by
 * NAND(Q1, Q3) into every CLR', decoded by a 74HC4511 into a 7-segment display
 * through seven 330 Ω resistors. SW1 (10 kΩ pull-down) is the clock.
 *
 *   U1 74HC74  e3   Q0 = 1Q (pin 5), Q1 = 2Q (pin 9)
 *   U2 74HC74  e13  Q2 = 1Q (pin 5), Q3 = 2Q (pin 9)
 *   U3 74HC00  e23  gate 1 = NAND(Q1, Q3) → CLR'; gates 2–4 inputs grounded
 *   U4 74HC4511 e33 A..D = Q0..Q3; LT', BL' high; LE low
 *   DS1        e52  common cathode to ground
 */
function decadeCounterDemo(): Demo {
  const r = railHoles('full');
  const w = (from: string, to: string): Command => ({ op: 'wire', from, to });
  const ff = [
    { chip: 'U1', d: 2, clk: 3, pre: 4, clr: 1, q: 5, qn: 6 },
    { chip: 'U1', d: 12, clk: 11, pre: 10, clr: 13, q: 9, qn: 8 },
    { chip: 'U2', d: 2, clk: 3, pre: 4, clr: 1, q: 5, qn: 6 },
    { chip: 'U2', d: 12, clk: 11, pre: 10, clr: 13, q: 9, qn: 8 },
  ];
  const row = (chipRow: number, n: number) => (n <= 7 ? chipRow + n - 1 : chipRow + 14 - n);
  const chipRow: Record<string, number> = { U1: 3, U2: 13, U3: 23, U4: 33 };
  const toRail = (part: string, n: number, high: boolean): Command => {
    const topSide = n > (part === 'U4' ? 8 : 7);
    const rr: RailId = topSide ? (high ? 'top+' : 'top-') : high ? 'bottom+' : 'bottom-';
    return w(p(part, n), r(rr, row(chipRow[part]!, n > 8 && part === 'U4' ? n - 2 : n)));
  };
  const segmentPins = {
    a: [13, 7],
    b: [12, 6],
    c: [11, 4],
    d: [10, 2],
    e: [9, 1],
    f: [15, 9],
    g: [14, 10],
  };

  return {
    title: 'Decade counter: 2 × 74HC74 → 74HC4511 → 7-segment',
    size: 'full',
    inputs: { CLK: 'SW1' },
    outputs: { display: 'DS1' },
    commands: [
      place('chip74hc74', 'hole:e3'), // U1
      place('chip74hc74', 'hole:e13'), // U2
      place('chip74hc00', 'hole:e23'), // U3
      place('chip74hc4511', 'hole:e33'), // U4
      place('display-7seg', 'hole:e52'), // DS1
      // Power and ground for every chip.
      toRail('U1', 14, true),
      toRail('U2', 14, true),
      toRail('U3', 14, true),
      w(p('U4', 16), r('top+', 33)),
      toRail('U1', 7, false),
      toRail('U2', 7, false),
      toRail('U3', 7, false),
      w(p('U4', 8), r('bottom-', 40)),
      // Every flip-flop: PRE' high, D = Q' (toggle).
      ...ff.flatMap((f) => [toRail(f.chip, f.pre, true), w(p(f.chip, f.qn), p(f.chip, f.d))]),
      // Ripple: each Q' clocks the next stage (Q' rises when Q falls: counts up).
      ...ff.slice(1).map((f, i) => w(p(ff[i]!.chip, ff[i]!.qn), p(f.chip, f.clk))),
      // Reset at 10 (Q3 Q1 = 1 1): NAND into every CLR'.
      w(p('U1', 9), p('U3', 1)),
      w(p('U2', 9), p('U3', 2)),
      ...ff.map((f) => w(p('U3', 3), p(f.chip, f.clr))),
      // Unused NAND inputs to ground.
      ...[4, 5, 9, 10, 12, 13].map((n) => toRail('U3', n, false)),
      // Decoder: A..D = Q0..Q3; LT' and BL' high; LE low (transparent).
      w(p('U1', 5), p('U4', 7)),
      w(p('U1', 9), p('U4', 1)),
      w(p('U2', 5), p('U4', 2)),
      w(p('U2', 9), p('U4', 6)),
      w(p('U4', 3), r('bottom+', 35)),
      w(p('U4', 4), r('bottom+', 36)),
      w(p('U4', 5), r('bottom-', 37)),
      // Segments: decoder output → 330 Ω → display pin. Common cathode to ground.
      ...Object.values(segmentPins).map(([out, seg]) =>
        leads('resistor', p('U4', out!), p('DS1', seg!)),
      ),
      w(p('DS1', 3), r('bottom-', 54)),
      // The clock: SW1 to +5 V, 10 kΩ pull-down, into the first stage's CLK.
      place('switch-spst', 'hole:a45'), // SW1: a45 – a47
      w('hole:b45', r('bottom+', 45)),
      leads('resistor-10k', 'hole:c47', r('bottom-', 47)),
      w('hole:d47', p('U1', 3)),
    ],
  };
}

export const FLIP_FLOP: Demo = flipFlopDemo();
export const DECADE_COUNTER: Demo = decadeCounterDemo();

/**
 * The same decade counter clocked by a 1 Hz CLK lead instead of the switch:
 * it counts by itself. Select the lead and pick another frequency to speed it
 * up (D-046).
 */
function clockedCounterDemo(): Demo {
  const manual = DECADE_COUNTER.commands;
  const isClockSwitch = (c: Command): boolean =>
    (c.op === 'place' && c.type === 'switch-spst') ||
    (c.op === 'wire' && c.from === 'hole:b45') ||
    (c.op === 'placeLeads' && c.type === 'resistor-10k');
  return {
    title: 'Decade counter clocked at 1 Hz',
    size: 'full',
    inputs: { CLK: 'CLK1' },
    outputs: { display: 'DS1' },
    commands: [
      ...manual.filter((c) => !isClockSwitch(c)),
      { op: 'clock', at: 'hole:a47', periodTicks: 1000 }, // row 47 feeds U1's CLK (wire d47)
    ],
  };
}

export const DECADE_COUNTER_CLOCKED: Demo = clockedCounterDemo();
