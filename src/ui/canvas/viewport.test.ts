import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  fitView,
  panBy,
  toBoard,
  toScreen,
  wheelFactor,
  zoomAt,
} from './viewport';

describe('viewport', () => {
  it('round-trips board and screen points', () => {
    const v = { zoom: 2.5, x: -40, y: 12 };
    const p = { x: 123, y: 45 };
    const back = toBoard(v, toScreen(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('zooms around the cursor: the board point under it stays put', () => {
    const at = { x: 300, y: 200 };
    const before = toBoard(IDENTITY, at);
    const v = zoomAt(IDENTITY, 2, at);
    expect(v.zoom).toBe(2);
    expect(toBoard(v, at)).toEqual(before);
    const out = zoomAt(v, 0.5, { x: 10, y: 20 });
    expect(out.zoom).toBe(1);
    expect(toBoard(out, { x: 10, y: 20 })).toEqual(toBoard(v, { x: 10, y: 20 }));
  });

  it('clamps the zoom range', () => {
    expect(zoomAt(IDENTITY, 100, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(IDENTITY, 0.001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it('pans, but keeps part of the board on screen', () => {
    expect(panBy(IDENTITY, 15, -5)).toEqual({ zoom: 1, x: 15, y: -5 });
    const board = { w: 1000, h: 400 };
    const viewport = { w: 800, h: 400 };
    expect(clampView({ zoom: 1, x: 5000, y: -5000 }, board, viewport)).toEqual({
      zoom: 1,
      x: 740,
      y: -340,
    });
    expect(clampView({ zoom: 1, x: -100, y: 0 }, board, viewport)).toEqual({
      zoom: 1,
      x: -100,
      y: 0,
    });
  });

  it('fits the board, centred, never past 100% by default', () => {
    expect(fitView({ w: 1320, h: 420 }, { w: 660, h: 420 })).toEqual({ zoom: 0.5, x: 0, y: 105 });
    expect(fitView({ w: 400, h: 200 }, { w: 800, h: 400 })).toEqual({ zoom: 1, x: 200, y: 100 });
  });

  it('turns wheel deltas into zoom factors', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48));
    expect(wheelFactor(-1e6)).toBeCloseTo(Math.exp(0.2));
  });
});
