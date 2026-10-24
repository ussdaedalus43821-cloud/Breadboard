// The 74HC chips Breadboard knows. Each is one gateChip(...) call.

import type { PartDef } from '../parts/types';
import {
  AND,
  HEX_INVERTER,
  NAND,
  NOR,
  NOT,
  QUAD_2_INPUT,
  QUAD_2_INPUT_NOR,
  gateChip,
} from './gate';

export const CHIPS: readonly PartDef[] = [
  gateChip({
    type: 'chip74hc00',
    part: '74HC00',
    label: '74HC00 quad NAND',
    pinout: QUAD_2_INPUT,
    fn: NAND,
  }),
  gateChip({
    type: 'chip74hc02',
    part: '74HC02',
    label: '74HC02 quad NOR',
    pinout: QUAD_2_INPUT_NOR,
    fn: NOR,
  }),
  gateChip({
    type: 'chip74hc04',
    part: '74HC04',
    label: '74HC04 hex inverter',
    pinout: HEX_INVERTER,
    fn: NOT,
  }),
  gateChip({
    type: 'chip74hc08',
    part: '74HC08',
    label: '74HC08 quad AND',
    pinout: QUAD_2_INPUT,
    fn: AND,
  }),
];
