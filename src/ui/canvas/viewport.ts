// Zoom and pan for the board canvas. A View maps board pixels (the layout's
// CSS pixels at zoom 1) to viewport pixels: screen = board * zoom + offset.
// Pure, so the math is testable without a canvas.

import type { Point } from '../../domain/breadboard/spec';

export interface View {
  readonly zoom: number;
  /** Viewport position of the board's (0, 0). */
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** Zoom step of the +/- buttons. */
export const ZOOM_STEP = 1.25;
/** Board pixels that stay inside the viewport however far you pan. */
const KEEP_VISIBLE = 60;

export const IDENTITY: View = { zoom: 1, x: 0, y: 0 };

export function toBoard(v: View, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function toScreen(v: View, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Multiply the zoom by `factor`, keeping the board point under `at` (viewport px) still. */
export function zoomAt(v: View, factor: number, at: Point): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { zoom: v.zoom, x: v.x + dx, y: v.y + dy };
}

/** Keep at least a strip of the board on screen, so it can't be lost off an edge. */
export function clampView(v: View, board: Size, viewport: Size): View {
  const keepX = Math.min(KEEP_VISIBLE, board.w * v.zoom, viewport.w);
  const keepY = Math.min(KEEP_VISIBLE, board.h * v.zoom, viewport.h);
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    zoom: v.zoom,
    x: clamp(v.x, keepX - board.w * v.zoom, viewport.w - keepX),
    y: clamp(v.y, keepY - board.h * v.zoom, viewport.h - keepY),
  };
}

/** The whole board centred in the viewport, no larger than `maxZoom`. */
export function fitView(board: Size, viewport: Size, maxZoom = 1): View {
  const zoom = clampZoom(Math.min(maxZoom, viewport.w / board.w, viewport.h / board.h));
  return { zoom, x: (viewport.w - board.w * zoom) / 2, y: (viewport.h - board.h * zoom) / 2 };
}

/** Zoom factor for one wheel event: smooth for trackpads, ~10% per mouse notch. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-200, Math.min(200, px)) * 0.001);
}
