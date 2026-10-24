// Draws the breadboard, placed parts, wires and the editor preview, and
// hit-tests holes, through a zoom/pan view (viewport.ts).

import {
  boardTerminals,
  terminalAtPoint,
  terminalPosition,
  type BoardSpec,
  type BoardTerminal,
} from '../../domain/breadboard/spec';
import { COLUMNS, pin, terminalKey } from '../../domain/breadboard/terminal';
import type { Circuit } from '../../domain/circuit/circuit';
import type { SimFrame } from '../../protocol/sim-protocol';
import { formatOhms, getPartDef } from '../../domain/parts/registry';
import type { Level } from '../../domain/sim/solver';
import type { Preview } from '../editor/editor';
import { createBoardLayout, type BoardLayout } from './board-layout';
import { drawPart, drawSupply, drawWire } from './part-shapes';
import { IDENTITY, clampView, toBoard, type Size, type View } from './viewport';

/** Analyzer channel colours, shared with the analyzer panel. */
export const PROBE_COLORS = ['#ffd43b', '#63e6be', '#74c0fc', '#f783ac'];

/** Everything one frame shows. */
export interface Scene {
  readonly circuit?: Circuit;
  /** Latest sim frame: levels, LED states, warnings. */
  readonly frame?: SimFrame | null;
  readonly preview?: Preview;
  /** Hole under the pointer, outlined. */
  readonly hover?: BoardTerminal | null;
  /** Wire ids on the logic analyzer, in channel order: tagged. */
  readonly probes?: readonly string[];
  /** Part id the inspector is showing: outlined. */
  readonly selected?: string | null;
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
  private viewport: Size;
  private current: View = IDENTITY;

  /** `viewport` is the canvas's CSS size; the board is drawn into it through `view`. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly spec: BoardSpec,
    viewport?: Size,
    pitchPx = 20,
  ) {
    this.layout = createBoardLayout(spec, pitchPx);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.viewport = viewport ?? this.boardSize;
    this.resize(this.viewport);
  }

  /** The board's size in board pixels (zoom 1). */
  get boardSize(): Size {
    return { w: this.layout.widthPx, h: this.layout.heightPx };
  }

  get viewportSize(): Size {
    return this.viewport;
  }

  get view(): View {
    return this.current;
  }

  /** Set the view; it is clamped so some of the board stays visible. */
  set view(v: View) {
    this.current = clampView(v, this.boardSize, this.viewport);
  }

  resize(viewport: Size): void {
    this.viewport = viewport;
    const dpr = globalThis.devicePixelRatio || 1;
    this.canvas.width = Math.round(viewport.w * dpr);
    this.canvas.height = Math.round(viewport.h * dpr);
    this.canvas.style.width = `${viewport.w}px`;
    this.canvas.style.height = `${viewport.h}px`;
    this.view = this.current;
  }

  /** The board terminal under a mouse event's position, or null. */
  hitTest(clientX: number, clientY: number): BoardTerminal | null {
    const p = this.layout.toPitch(this.localPoint(clientX, clientY));
    return terminalAtPoint(this.spec, p.x, p.y);
  }

  /** Viewport pixel position of a pointer event (for zooming around it). */
  screenPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Board pixel position of a pointer event, the view undone. */
  localPoint(clientX: number, clientY: number): { x: number; y: number } {
    return toBoard(this.current, this.screenPoint(clientX, clientY));
  }

  draw(scene: Scene = {}): void {
    const { ctx, layout, spec } = this;
    const px = layout.pitchPx;
    const dpr = globalThis.devicePixelRatio || 1;
    const v = this.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);

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

    const { circuit, frame, preview, hover, pointer } = scene;
    if (circuit) {
      const levels = new Map<string, Level>();
      for (const net of frame?.nets ?? []) for (const k of net.terminals) levels.set(k, net.level);
      const warned = new Set((frame?.warnings ?? []).flatMap((w) => w.at));
      for (const part of circuit.parts) {
        const state = frame?.parts[part.id] ?? {};
        const pinKey = (name: string): string => terminalKey(pin(part.id, name));
        const def = getPartDef(part.type);
        const label =
          def.kind === 'resistor' ? `${part.id} ${formatOhms(Number(def.props['ohms']))}` : part.id;
        drawPart(ctx, spec, layout, def, part.pins, label, {
          levelOf: (name) => levels.get(pinKey(name)),
          warn: new Set(Object.keys(part.pins).filter((name) => warned.has(pinKey(name)))),
          ...(state.lit === undefined ? {} : { lit: state.lit }),
          ...(state.brightness === undefined ? {} : { brightness: state.brightness }),
          ...(state.burnt === undefined ? {} : { burnt: state.burnt }),
          ...(state.segments === undefined ? {} : { segments: state.segments }),
          ...(state.position === undefined ? {} : { position: state.position }),
        });
      }
      for (const wire of circuit.wires) {
        drawWire(ctx, spec, layout, wire, {
          levelOf: (end) => levels.get(terminalKey(end === 'from' ? wire.from : wire.to)),
        });
      }
      for (const supply of circuit.supplies) drawSupply(ctx, spec, layout, supply);

      // Probed wires: a numbered tag at the middle of each, in its analyzer channel colour.
      (scene.probes ?? []).forEach((id, i) => {
        const w = circuit.wires.find((x) => x.id === id);
        if (!w) return;
        const a = layout.toPixel(terminalPosition(spec, w.from));
        const b = layout.toPixel(terminalPosition(spec, w.to));
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.fillStyle = PROBE_COLORS[i % PROBE_COLORS.length]!;
        ctx.beginPath();
        ctx.arc(m.x, m.y, px * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = `bold ${Math.round(px * 0.5)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), m.x, m.y + 0.5);
      });

      const selPart = scene.selected
        ? circuit.parts.find((p) => p.id === scene.selected)
        : undefined;
      const selLead = scene.selected
        ? circuit.supplies.find((x) => x.id === scene.selected)
        : undefined;
      const selTerminals = selPart ? Object.values(selPart.pins) : selLead ? [selLead.at] : [];
      if (selTerminals.length > 0) {
        const pts = selTerminals.map((t) => layout.toPixel(terminalPosition(spec, t)));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const pad = px * 0.75;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = THEME.holeSelected;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.min(...xs) - pad,
          Math.min(...ys) - pad,
          Math.max(...xs) - Math.min(...xs) + 2 * pad,
          Math.max(...ys) - Math.min(...ys) + 2 * pad,
        );
        ctx.restore();
      }
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
