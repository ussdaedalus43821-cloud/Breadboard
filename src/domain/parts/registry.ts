// The parts registry: every part type Breadboard knows, as data.

import type { PartDef, PinFootprint, PinRole } from './types';

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

/** Standard 14-pin quad 2-input gate pinout (7400, 7408, 7432, 7486, …). */
const QUAD_2_INPUT_GATE_PINS: Readonly<Record<string, readonly [PinRole, string]>> = {
  '1': ['input', '1A'],
  '2': ['input', '1B'],
  '3': ['output', '1Y'],
  '4': ['input', '2A'],
  '5': ['input', '2B'],
  '6': ['output', '2Y'],
  '7': ['ground', 'GND'],
  '8': ['output', '3Y'],
  '9': ['input', '3A'],
  '10': ['input', '3B'],
  '11': ['output', '4Y'],
  '12': ['input', '4A'],
  '13': ['input', '4B'],
  '14': ['power', 'VCC'],
};

function withRoles(
  pins: readonly PinFootprint[],
  roles: Readonly<Record<string, readonly [PinRole, string]>>,
): PinFootprint[] {
  return pins.map((p) => {
    const r = roles[p.pin];
    return r ? { ...p, role: r[0], name: r[1] } : p;
  });
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
  {
    // Pinout and pin roles only. Gate logic arrives in Phase 3.
    type: 'chip74hc00',
    kind: 'chip',
    label: '74HC00 quad NAND',
    idPrefix: 'U',
    pins: withRoles(dipFootprint(14), QUAD_2_INPUT_GATE_PINS),
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
