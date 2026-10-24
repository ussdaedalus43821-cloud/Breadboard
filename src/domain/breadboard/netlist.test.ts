import { describe, expect, it } from 'vitest';
import { UnionFind } from './netlist';

describe('UnionFind', () => {
  it('unions transitively and keeps others apart', () => {
    const uf = new UnionFind();
    for (const k of ['a', 'b', 'c', 'd']) uf.add(k);
    uf.union('a', 'b');
    uf.union('c', 'b');
    expect(uf.find('a')).toBe(uf.find('c'));
    expect(uf.find('d')).not.toBe(uf.find('a'));
  });

  it('handles long chains', () => {
    const uf = new UnionFind();
    for (let i = 0; i < 10_000; i++) uf.add(String(i));
    for (let i = 1; i < 10_000; i++) uf.union(String(i - 1), String(i));
    expect(uf.find('0')).toBe(uf.find('9999'));
  });

  it('throws on unknown keys', () => {
    expect(() => new UnionFind().find('x')).toThrow(/unknown key/);
  });
});
