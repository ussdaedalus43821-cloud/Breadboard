// The 74HC chips Breadboard knows. Gate chips are one gateChip(...) call each;
// chips with memory are in sequential.ts.

import type { PartDef } from '../parts/types';
import {
  AND,
  HEX_INVERTER,
  NAND,
  NOR,
  NOT,
  QUAD_2_INPUT,
  OR,
  QUAD_2_INPUT_NOR,
  XOR,
  gateChip,
} from './gate';
import { CHIP_74HC4511, CHIP_74HC74 } from './sequential';

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
  gateChip({
    type: 'chip74hc32',
    part: '74HC32',
    label: '74HC32 quad OR',
    pinout: QUAD_2_INPUT,
    fn: OR,
  }),
  gateChip({
    type: 'chip74hc86',
    part: '74HC86',
    label: '74HC86 quad XOR',
    pinout: QUAD_2_INPUT,
    fn: XOR,
  }),
  CHIP_74HC74,
  CHIP_74HC4511,
];
