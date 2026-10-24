// The parts registry: every part type Breadboard knows, as data.

import type { PartDef, PinFootprint } from './types';

/** DIP package footprint, pin 1 at the anchor. Pins 1…n/2 run along the anchor's
 *  column toward higher rows; the rest come back along the column 0.3" away (dy = -3,
 *  across the channel), so numbering is counterclockwise seen from above. */
export function dipFootprint(pinCount: number): PinFootprint[] {
  if (pinCount < 4 || pinCount % 2 !== 0) throw new RangeError(`bad DIP pin count: ${pinCount}`);
  const side = pinCount / 2;
  const pins: PinFootprint[] = [];
  for (let n = 1; n <= side; n++) pins.push({ pin: String(n), dx: n - 1, dy: 0 });
  for (let n = side + 1; n <= pinCount; n++)
    pins.push({ pin: String(n), dx: pinCount - n, dy: -3 });
  return pins;
}

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
    props: { color: 'red', forwardVolts: 2.0, maxMilliamps: 20 },
  },
  {
    type: 'resistor',
    kind: 'resistor',
    label: 'Resistor 330 Ω',
    idPrefix: 'R',
    // 0.4" lead spacing, the usual for a 1/4 W resistor lying flat.
    pins: [
      { pin: '1', dx: 0, dy: 0 },
      { pin: '2', dx: 4, dy: 0 },
    ],
    leads: 'flexible',
    props: { ohms: 330 },
  },
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
    props: { poles: 1, throws: 1 },
  },
  {
    // Phase 1 placeholder: footprint and pinout only. Logic arrives in Phase 3.
    type: 'chip74hc00',
    kind: 'chip',
    label: '74HC00 quad NAND',
    idPrefix: 'U',
    pins: dipFootprint(14),
    leads: 'fixed',
    anchorColumns: ['e'],
    props: { part: '74HC00', vccPin: '14', gndPin: '7' },
  },
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
