import { describe, expect, it } from 'vitest';
import { getPartDef } from '../parts/registry';
import type { Level } from '../sim/levels';
import { AND, NAND, NOR, NOT, OR, XOR, gateChip, QUAD_2_INPUT } from './gate';

const pairs: Array<[Level, Level]> = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

describe('gate functions', () => {
  it.each([
    ['AND', AND, [0, 0, 0, 1]],
    ['OR', OR, [0, 1, 1, 1]],
    ['NAND', NAND, [1, 1, 1, 0]],
    ['NOR', NOR, [1, 0, 0, 0]],
    ['XOR', XOR, [0, 1, 1, 0]],
  ] as const)('%s truth table', (_, fn, expected) => {
    expect(pairs.map((p) => fn(p))).toEqual(expected);
  });

  it('NOT', () => {
    expect([NOT([0]), NOT([1]), NOT(['Z']), NOT(['X'])]).toEqual([1, 0, 'X', 'X']);
  });

  it('a floating or unknown input gives X unless another input decides', () => {
    expect(NAND(['Z', 1])).toBe('X');
    expect(NAND(['Z', 0])).toBe(1); // 0 is controlling for NAND
    expect(AND(['X', 0])).toBe(0);
    expect(OR(['Z', 1])).toBe(1);
    expect(NOR(['X', 0])).toBe('X');
    expect(XOR(['Z', 1])).toBe('X');
  });
});

describe('gateChip builder', () => {
  it.each(['chip74hc00', 'chip74hc02', 'chip74hc04', 'chip74hc08'])(
    '%s: 14 pins, every pin has a role',
    (type) => {
      const def = getPartDef(type);
      expect(def.pins).toHaveLength(14);
      expect(def.pins.every((p) => p.role && p.name)).toBe(true);
      expect(def.pins.find((p) => p.pin === '14')).toMatchObject({ role: 'power', name: 'VCC' });
      expect(def.pins.find((p) => p.pin === '7')).toMatchObject({ role: 'ground', name: 'GND' });
      for (const g of def.logic!.blocks) {
        expect(def.pins.find((p) => p.pin === g.outputs[0])!.role).toBe('output');
        for (const i of g.inputs) expect(def.pins.find((p) => p.pin === i)!.role).toBe('input');
      }
    },
  );

  it('names pins like the datasheet', () => {
    const nor = getPartDef('chip74hc02');
    const name = (pin: string) => nor.pins.find((p) => p.pin === pin)!.name;
    expect([name('1'), name('2'), name('3'), name('13')]).toEqual(['1Y', '1A', '1B', '4Y']);
    const inv = getPartDef('chip74hc04');
    expect(inv.logic!.blocks).toHaveLength(6);
    expect(inv.pins.find((p) => p.pin === '8')!.name).toBe('4Y');
  });

  it('rejects a pinout that leaves pins unassigned', () => {
    expect(() =>
      gateChip({ type: 'x', part: 'X', label: 'x', pinout: QUAD_2_INPUT.slice(0, 3), fn: NAND }),
    ).toThrow(/does not cover 14 pins/);
  });
});
