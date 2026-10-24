// Draws the breadboard, placed parts, wires and the editor preview, and
// hit-tests holes. No sim state yet (Phase 2).

import {
  boardTerminals,
  terminalAtPoint,
  terminalPosition,
  type BoardSpec,
  type BoardTerminal,
} from '../../domain/breadboard/spec';
import { COLUMNS } from '../../domain/breadboard/terminal';
import type { Circuit } from '../../domain/circuit/circuit';
import { getPartDef } from '../../domain/parts/registry';
import type { Preview } from '../editor/editor';
import { createBoardLayout, type BoardLayout } from './board-layout';
import { drawPart, drawWire } from './part-shapes';

/** Everything one frame shows. */
export interface Scene {
  readonly circuit?: Circuit;
  readonly preview?: Preview;
  /** Hole under the pointer, outlined. */
  readonly hover?: BoardTerminal | null;
  /** Free-floating wire end (pixels) while dragging off any hole. */
  readonly pointer?: { readonly x: number; readonly y: number } | null;
}

const THEME = {
  board: '#f4f1e8',
  boardEdge: '#d8d2c0',
  channel: '#e2dccb',
  hole: '#3a3a3a',
  holeSelected: '#ff9f1c',
  railPlus: '#d64545',
  railMinus: '#3b6fd6',
  label: '#8a846f',
};

export class BoardRenderer {
  readonly layout: BoardLayout;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly spec: BoardSpec,
    pitchPx = 20,
  ) {
    this.layout = createBoardLayout(spec, pitchPx);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(this.layout.widthPx * dpr);
    canvas.height = Math.round(this.layout.heightPx * dpr);
    canvas.style.width = `${this.layout.widthPx}px`;
    canvas.style.height = `${this.layout.heightPx}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** The board terminal under a mouse event's position, or null. */
  hitTest(clientX: number, clientY: number): BoardTerminal | null {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.layout.toPitch({ x: clientX - rect.left, y: clientY - rect.top });
    return terminalAtPoint(this.spec, p.x, p.y);
  }

  /** Canvas-local pixel position of a pointer event. */
  localPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  draw(scene: Scene = {}): void {
    const { ctx, layout, spec } = this;
    const px = layout.pitchPx;
    ctx.clearRect(0, 0, layout.widthPx, layout.heightPx);

    ctx.fillStyle = THEME.board;
    ctx.strokeStyle = THEME.boardEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, layout.widthPx - 2, layout.heightPx - 2, px / 2);
    ctx.fill();
    ctx.stroke();

    // Centre channel between f (y=7) and e (y=10).
    const ch = layout.toPixel({ x: 0, y: 8.5 });
    ctx.fillStyle = THEME.channel;
    ctx.fillRect(layout.marginPx / 2, ch.y - px * 0.4, layout.widthPx - layout.marginPx, px * 0.8);

    // Rail stripes.
    const stripe = (y: number, color: string): void => {
      const a = layout.toPixel({ x: 0, y });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(layout.marginPx / 2, a.y);
      ctx.lineTo(layout.widthPx - layout.marginPx / 2, a.y);
      ctx.stroke();
    };
    stripe(-0.6, THEME.railPlus);
    stripe(1.6, THEME.railMinus);
    stripe(15.4, THEME.railMinus);
    stripe(17.6, THEME.railPlus);

    // Labels: column letters on both ends, every 5th row number.
    ctx.fillStyle = THEME.label;
    ctx.font = `${Math.round(px * 0.5)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of COLUMNS) {
      const left = layout.toPixel(terminalPosition(spec, { kind: 'hole', column: c, row: 1 }));
      const right = layout.toPixel(
        terminalPosition(spec, { kind: 'hole', column: c, row: spec.rows }),
      );
      ctx.fillText(c, left.x - px, left.y);
      ctx.fillText(c, right.x + px, right.y);
    }
    for (let row = 1; row <= spec.rows; row++) {
      if (row !== 1 && row % 5 !== 0) continue;
      const top = layout.toPixel(terminalPosition(spec, { kind: 'hole', column: 'j', row }));
      ctx.fillText(String(row), top.x, top.y - px * 0.9);
    }

    const s = px * 0.32;
    ctx.fillStyle = THEME.hole;
    for (const t of boardTerminals(spec)) {
      const p = layout.toPixel(terminalPosition(spec, t));
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }

    const { circuit, preview, hover, pointer } = scene;
    if (circuit) {
      for (const part of circuit.parts) {
        drawPart(ctx, spec, layout, getPartDef(part.type), part.pins, part.id);
      }
      for (const wire of circuit.wires) drawWire(ctx, spec, layout, wire);
    }

    if (preview?.kind === 'part' && preview.pins) {
      drawPart(ctx, spec, layout, getPartDef(preview.type), preview.pins, '', {
        ghost: true,
        invalid: !preview.valid,
      });
    } else if (preview?.kind === 'wire') {
      const to = preview.to ?? (pointer ? layout.toPixel(layout.toPitch(pointer)) : null);
      if (to) {
        drawWire(
          ctx,
          spec,
          layout,
          { id: 'W0', from: preview.from, to },
          {
            ghost: true,
            invalid: !preview.valid,
          },
        );
      }
    }

    if (hover) {
      const p = layout.toPixel(terminalPosition(spec, hover));
      ctx.strokeStyle = THEME.holeSelected;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - px * 0.4, p.y - px * 0.4, px * 0.8, px * 0.8);
    }
  }
}
