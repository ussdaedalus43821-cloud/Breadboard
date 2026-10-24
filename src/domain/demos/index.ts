import { DECADE_COUNTER, DECADE_COUNTER_CLOCKED, FLIP_FLOP } from './counter';
import { HALF_ADDER, type Demo } from './half-adder';

export type { Demo } from './half-adder';

/** The demos the UI offers, by key. */
export const DEMOS: Readonly<Record<string, Demo>> = {
  'half-adder': HALF_ADDER,
  'flip-flop': FLIP_FLOP,
  'decade-counter': DECADE_COUNTER,
  'decade-counter-clocked': DECADE_COUNTER_CLOCKED,
};
