// The parts registry: every part type Breadboard knows, as data.

import { CHIPS } from '../chips/catalog';
import type { PartDef } from './types';

/** The resistor values Breadboard stocks, smallest first. */
export const RESISTOR_VALUES: readonly number[] = [100, 330, 1000, 10_000];

/** Registry type for a resistance, or undefined if it is not stocked. */
export function resistorType(ohms: unknown): string | undefined {
  if (typeof ohms !== 'number' || !RESISTOR_VALUES.includes(ohms)) return undefined;
  return ohms === 330 ? 'resistor' : `resistor-${ohms >= 1000 ? `${ohms / 1000}k` : ohms}`;
}

/** Format a resistance the way it is printed: 330 Ω, 1 kΩ, 10 kΩ. */
export function formatOhms(ohms: number): string {
  return ohms >= 1000 ? `${ohms / 1000} kΩ` : `${ohms} Ω`;
}

/** A 1/4 W axial resistor lying flat, 0.4" lead spacing. 330 Ω keeps the plain `resistor` type. */
function resistor(ohms: number): PartDef {
  const suffix = ohms >= 1000 ? `${ohms / 1000}k` : String(ohms);
  return {
    type: ohms === 330 ? 'resistor' : `resistor-${suffix}`,
    kind: 'resistor',
    label: `Resistor ${formatOhms(ohms)}`,
    idPrefix: 'R',
    pins: [
      { pin: '1', dx: 0, dy: 0 },
      { pin: '2', dx: 4, dy: 0 },
    ],
    leads: 'flexible',
    props: { ohms },
  };
}

/**
 * Single-digit common-cathode 7-segment display (0.56", 5161AS-type pinout).
 * Ten pins in two rows 0.6" apart: on the board, pin 1 goes in column e and
 * the top row lands in column i. Pins 3 and 8 are the common cathode, joined
 * inside. Each segment is an LED: it needs its own series resistor.
 *
 *        10 9 8 7 6           a
 *        g  f C a b         f   b
 *                             g
 *        e  d C c dp        e   c
 *        1  2 3 4 5           d   dp
 */
const SEVEN_SEGMENT: PartDef = {
  type: 'display-7seg',
  kind: 'display',
  label: '7-segment display (common cathode)',
  idPrefix: 'DS',
  pins: [
    ...['e', 'd', 'COM', 'c', 'DP'].map((name, i) => ({
      pin: String(i + 1),
      dx: i,
      dy: 0,
      role: 'passive' as const,
      name,
    })),
    ...['b', 'a', 'COM', 'f', 'g'].map((name, i) => ({
      pin: String(i + 6),
      dx: 4 - i,
      dy: -6,
      role: 'passive' as const,
      name,
    })),
  ],
  leads: 'fixed',
  anchorColumns: ['e'],
  internalNets: [['3', '8']],
  segments: { a: '7', b: '6', c: '4', d: '2', e: '1', f: '9', g: '10', dp: '5' },
  commonCathode: '3',
  props: { color: 'red', forwardVolts: 2.0, seriesOhms: 15, maxMilliamps: 20, burnMilliamps: 40 },
};

const DEFS: readonly PartDef[] = [
  {
    type: 'led-red',
    kind: 'led',
    label: 'LED (red)',
    idPrefix: 'D',
    pins: [
      { pin: 'anode', dx: 0, dy: 0 },
      { pin: 'cathode', dx: 1, dy: 0 },
    ],
    leads: 'flexible',
    // Typical 5 mm red LED: 2.0 V forward, ~15 Ω once conducting, 20 mA rated.
    // Past burnMilliamps it is destroyed (an open circuit until replaced).
    props: { color: 'red', forwardVolts: 2.0, seriesOhms: 15, maxMilliamps: 20, burnMilliamps: 40 },
  },
  ...[330, 100, 1000, 10_000].map(resistor),
  {
    type: 'switch-spst',
    kind: 'switch',
    label: 'Switch (SPST)',
    idPrefix: 'SW',
    pins: [
      { pin: '1', dx: 0, dy: 0 },
      { pin: '2', dx: 2, dy: 0 },
    ],
    leads: 'fixed',
    // position 0 = open, 1 = closed.
    props: { poles: 1, throws: 1 },
  },
  {
    // SPDT slide switch (docs/NOVALANG_BRIDGE.md board.switch): three pins in
    // consecutive rows; position 0 joins com–a, position 1 joins com–b.
    // In the registry for the bridge; not in the Phase 2 palette (D-012).
    type: 'switch-spdt',
    kind: 'switch',
    label: 'Switch (SPDT)',
    idPrefix: 'SW',
    pins: [
      { pin: 'a', dx: 0, dy: 0 },
      { pin: 'com', dx: 1, dy: 0 },
      { pin: 'b', dx: 2, dy: 0 },
    ],
    leads: 'fixed',
    props: { poles: 1, throws: 2 },
  },
  ...CHIPS,
  SEVEN_SEGMENT,
];

export class UnknownPartTypeError extends RangeError {
  override name = 'UnknownPartTypeError';
}

const BY_TYPE: ReadonlyMap<string, PartDef> = new Map(DEFS.map((d) => [d.type, d]));

export function partTypes(): string[] {
  return DEFS.map((d) => d.type);
}

export function hasPartDef(type: string): boolean {
  return BY_TYPE.has(type);
}

export function getPartDef(type: string): PartDef {
  const def = BY_TYPE.get(type);
  if (!def) throw new UnknownPartTypeError(`unknown part type: ${type}`);
  return def;
}
