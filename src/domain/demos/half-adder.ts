// Half adder on one 74HC00, as the command list that builds it. Every part
// uses its default footprint, so the same circuit can be built by hand with
// palette clicks and drags (docs/demos/phase-3.md). D-022.
//
//   Sum   = A XOR B = NAND(NAND(A, n1), NAND(B, n1)),  n1 = NAND(A, B)
//   Carry = A AND B = NOT n1
//
// Four NANDs make the XOR; a fifth would be needed for a driven carry. Instead
// the carry LED *sinks* into n1 (+5 V → R4 → D2 → n1): it lights exactly when
// n1 is low, i.e. when A = B = 1. Open SPST switches would leave A and B
// floating, so each has a pull-down (R1, R2).
//
//   SW1 a3/a5 → A on row 5 · SW2 a7/a9 → B on row 9 · U1 pin 1 at e16
//   Sum: U1 pin 11 → R3 → D1 → ground · Carry: +5 V → R4 → D2 → U1 pin 3

import type { Command } from '../circuit/commands';

export interface Demo {
  readonly title: string;
  /** Apply to a bench board (benchCircuit), in order. */
  readonly commands: readonly Command[];
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: Readonly<Record<string, string>>;
}

const w = (from: string, to: string): Command => ({ op: 'wire', from, to });
const place = (type: string, at: string): Command => ({ op: 'place', type, at });

export const HALF_ADDER: Demo = {
  title: 'Half adder (one 74HC00)',
  inputs: { A: 'SW1', B: 'SW2' },
  outputs: { sum: 'D1', carry: 'D2' },
  commands: [
    // Inputs: switch to +5 V, pull-down to ground.
    place('switch-spst', 'hole:a3'), // SW1: row 3 (+5 V) – row 5 (A)
    place('switch-spst', 'hole:a7'), // SW2: row 7 (+5 V) – row 9 (B)
    place('resistor', 'hole:c1'), // R1: row 1 (ground) – row 5 (A)
    place('resistor', 'hole:c9'), // R2: row 9 (B) – row 13 (ground)
    w('hole:b3', 'rail:bottom+:3'),
    w('hole:b7', 'rail:bottom+:7'),
    w('hole:b1', 'rail:bottom-:2'),
    w('hole:b13', 'rail:bottom-:12'),

    // The chip and its supply.
    place('chip74hc00', 'hole:e16'), // U1
    w('hole:j16', 'rail:top+:15'), // pin 14 VCC
    w('hole:a22', 'rail:bottom-:19'), // pin 7 GND

    // XOR from four NANDs.
    w('hole:d5', 'hole:d16'), // A → 1A (pin 1)
    w('hole:e5', 'hole:d19'), // A → 2A (pin 4)
    w('hole:d9', 'hole:d17'), // B → 1B (pin 2)
    w('hole:e9', 'hole:j21'), // B → 3A (pin 9)
    w('hole:d18', 'hole:d20'), // n1 = 1Y (pin 3) → 2B (pin 5)
    w('hole:c20', 'hole:g20'), // n1 → 3B (pin 10)
    w('hole:d21', 'hole:g18'), // n2 = 2Y (pin 6) → 4A (pin 12)
    w('hole:g22', 'hole:g17'), // n3 = 3Y (pin 8) → 4B (pin 13)

    // Sum LED, sourced by 4Y (pin 11).
    place('resistor', 'hole:h19'), // R3: row 19 (sum) – row 23
    place('led-red', 'hole:i23'), // D1: anode row 23, cathode row 24
    w('hole:j24', 'rail:top-:20'),

    // Carry LED, sinking into n1.
    place('resistor', 'hole:a24'), // R4: row 24 (+5 V) – row 28
    w('hole:b24', 'rail:bottom+:21'),
    place('led-red', 'hole:b28'), // D2: anode row 28, cathode row 29
    w('hole:c29', 'hole:c18'), // cathode → n1
  ],
};
