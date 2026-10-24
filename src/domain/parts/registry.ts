// The parts registry: every part type Breadboard knows, as data.

import { CHIPS } from '../chips/catalog';
import type { PartDef } from './types';

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
  ...CHIPS,
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
