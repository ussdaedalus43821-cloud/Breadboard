// Pitch-coordinate ↔ pixel mapping for the board. Pure, so it is testable
// without a canvas; the renderer and hit-testing both go through it.

import type { BoardSpec, Point } from '../../domain/breadboard/spec';

export interface BoardLayout {
  readonly pitchPx: number;
  readonly marginPx: number;
  /** CSS-pixel size of the whole drawing, margins included. */
  readonly widthPx: number;
  readonly heightPx: number;
  toPixel(p: Point): Point;
  toPitch(px: Point): Point;
}

export function createBoardLayout(
  spec: BoardSpec,
  pitchPx = 20,
  marginPx = 2 * pitchPx,
): BoardLayout {
  // Holes sit at integer pitch coordinates 0..width-1 / 0..height-1.
  const origin = marginPx;
  return {
    pitchPx,
    marginPx,
    widthPx: 2 * marginPx + (spec.width - 1) * pitchPx,
    heightPx: 2 * marginPx + (spec.height - 1) * pitchPx,
    toPixel: (p) => ({ x: origin + p.x * pitchPx, y: origin + p.y * pitchPx }),
    toPitch: (px) => ({ x: (px.x - origin) / pitchPx, y: (px.y - origin) / pitchPx }),
  };
}
