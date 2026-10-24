import { DECADE_COUNTER, FLIP_FLOP } from './counter';
import { HALF_ADDER, type Demo } from './half-adder';

export type { Demo } from './half-adder';

/** The demos the UI offers, by key. */
export const DEMOS: Readonly<Record<string, Demo>> = {
  'half-adder': HALF_ADDER,
  'flip-flop': FLIP_FLOP,
  'decade-counter': DECADE_COUNTER,
};
