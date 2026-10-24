import { describe, expect, it } from 'vitest';
import { benchCircuit, emptyCircuit } from './circuit';
import { History } from './history';

describe('History', () => {
  const a = emptyCircuit();
  const b = benchCircuit();

  it('starts empty', () => {
    expect(new History().state).toEqual({ canUndo: false, canRedo: false });
  });

  it('caps the undo stack', () => {
    const h = new History(3);
    for (let i = 0; i < 5; i++) h.record(a, `e${i}`);
    let n = 0;
    while (h.undo(b)) n++;
    expect(n).toBe(3);
  });

  it('a group that changed nothing leaves no entry', () => {
    const h = new History();
    h.begin(a, 'script');
    h.record(a, 'ignored inside the group');
    expect(h.end(a)).toBe(false);
    expect(h.state.canUndo).toBe(false);
  });
});
