import { describe, expect, it } from 'vitest';
import { resistorBands } from './part-shapes';

describe('resistor colour code', () => {
  it.each([
    [330, ['#f08c00', '#f08c00', '#7c4a1e']], // orange orange brown
    [100, ['#7c4a1e', '#1b1b1b', '#7c4a1e']], // brown black brown
    [1000, ['#7c4a1e', '#1b1b1b', '#d6332e']], // brown black red
    [10_000, ['#7c4a1e', '#1b1b1b', '#f08c00']], // brown black orange
  ])('%i Ω', (ohms, bands) => {
    expect(resistorBands(ohms)).toEqual(bands);
  });
});
