// Simple shapes for parts and wires: a body plus a dot on every pin.

import {
  terminalPosition,
  type BoardSpec,
  type BoardTerminal,
  type Point,
} from '../../domain/breadboard/spec';
import type { Wire } from '../../domain/circuit/circuit';
import type { PartDef } from '../../domain/parts/types';
import type { BoardLayout } from './board-layout';

const WIRE_COLORS = ['#e8a33d', '#2f9e44', '#1c7ed6', '#c92a2a', '#7048e8', '#212529'];
const PIN = '#c0c4c8';
const PIN_EDGE = '#5c636a';
const INVALID = '#e03131';

export interface DrawStyle {
  /** Ghost preview: translucent. */
  readonly ghost?: boolean;
  /** Ghost that cannot be placed here. */
  readonly invalid?: boolean;
}

function px(spec: BoardSpec, layout: BoardLayout, t: BoardTerminal): Point {
  return layout.toPixel(terminalPosition(spec, t));
}

function pinDot(ctx: CanvasRenderingContext2D, p: Point, r: number, invalid: boolean): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = invalid ? INVALID : PIN;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PIN_EDGE;
  ctx.stroke();
}

function lead(ctx: CanvasRenderingContext2D, a: Point, b: Point, width: number): void {
  ctx.strokeStyle = PIN;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function wireColor(id: string): string {
  const n = Number(id.replace(/\D/g, '')) || 0;
  return WIRE_COLORS[n % WIRE_COLORS.length]!;
}

export function drawWire(
  ctx: CanvasRenderingContext2D,
  spec: BoardSpec,
  layout: BoardLayout,
  wire: Pick<Wire, 'id' | 'from'> & { readonly to: BoardTerminal | Point },
  style: DrawStyle = {},
): void {
  const a = px(spec, layout, wire.from);
  const b = 'kind' in wire.to ? px(spec, layout, wire.to) : wire.to;
  const pitch = layout.pitchPx;
  ctx.save();
  if (style.ghost) ctx.globalAlpha = 0.6;
  ctx.strokeStyle = style.invalid ? INVALID : wireColor(wire.id);
  ctx.lineWidth = pitch * 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  pinDot(ctx, a, pitch * 0.14, false);
  pinDot(ctx, b, pitch * 0.14, false);
  ctx.restore();
}

export function drawPart(
  ctx: CanvasRenderingContext2D,
  spec: BoardSpec,
  layout: BoardLayout,
  def: PartDef,
  pins: Readonly<Record<string, BoardTerminal>>,
  label: string,
  style: DrawStyle = {},
): void {
  const pitch = layout.pitchPx;
  const at = (name: string): Point => px(spec, layout, pins[name]!);
  const points = Object.values(pins).map((t) => px(spec, layout, t));
  const invalid = !!style.invalid;
  ctx.save();
  if (style.ghost) ctx.globalAlpha = 0.6;

  switch (def.kind) {
    case 'led': {
      const a = at('anode');
      const k = at('cathode');
      const mid = { x: (a.x + k.x) / 2, y: (a.y + k.y) / 2 - pitch * 0.6 };
      lead(ctx, a, mid, 2);
      lead(ctx, k, mid, 2);
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, pitch * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = String(def.props['color'] ?? 'red') === 'red' ? '#e5484d' : '#888';
      ctx.fill();
      ctx.strokeStyle = '#8f1d22';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case 'resistor': {
      const a = at('1');
      const b = at('2');
      lead(ctx, a, b, 2);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const bodyLen = Math.min(len * 0.6, pitch * 2.4);
      const bodyH = pitch * 0.6;
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.rotate(angle);
      ctx.fillStyle = '#d9c39a';
      ctx.strokeStyle = '#8c7650';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-bodyLen / 2, -bodyH / 2, bodyLen, bodyH, bodyH / 3);
      ctx.fill();
      ctx.stroke();
      // 330 Ω: orange, orange, brown, gold.
      ['#f08c00', '#f08c00', '#7c4a1e', '#c9a227'].forEach((color, i) => {
        ctx.fillStyle = color;
        const x = -bodyLen / 2 + bodyLen * (0.2 + i * (i === 3 ? 0.2 : 0.16));
        ctx.fillRect(x, -bodyH / 2, bodyLen * 0.07, bodyH);
      });
      break;
    }
    case 'switch':
    case 'chip': {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const pad = pitch * 0.45;
      const x0 = Math.min(...xs) - pad;
      const x1 = Math.max(...xs) + pad;
      const chip = def.kind === 'chip';
      // A DIP body sits over the channel between its two pin rows; a switch body sits over its pins.
      const y0 = chip ? Math.min(...ys) + pitch * 0.4 : Math.min(...ys) - pitch * 0.55;
      const y1 = chip ? Math.max(...ys) - pitch * 0.4 : Math.max(...ys) + pitch * 0.55;
      if (chip)
        for (const p of points)
          lead(ctx, p, { x: p.x, y: p.y < (y0 + y1) / 2 ? y0 : y1 }, pitch * 0.25);
      ctx.fillStyle = chip ? '#25262b' : '#495057';
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, pitch * 0.15);
      ctx.fill();
      if (chip) {
        // Notch on the pin-1 end, dot by pin 1.
        ctx.fillStyle = '#868e96';
        ctx.beginPath();
        ctx.arc(x0, (y0 + y1) / 2, pitch * 0.35, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        const p1 = at('1');
        ctx.beginPath();
        ctx.arc(p1.x, y1 - pitch * 0.35, pitch * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dee2e6';
        ctx.font = `${Math.round(pitch * 0.55)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(def.props['part'] ?? def.label), (x0 + x1) / 2, (y0 + y1) / 2);
      } else {
        // Slider knob.
        ctx.fillStyle = '#f1f3f5';
        const w = (x1 - x0) * 0.3;
        ctx.fillRect(x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.25, w, (y1 - y0) * 0.5);
      }
      break;
    }
  }
  ctx.restore();

  ctx.save();
  if (style.ghost) ctx.globalAlpha = 0.6;
  for (const p of points) pinDot(ctx, p, pitch * 0.17, invalid);
  if (!style.ghost && label) {
    ctx.fillStyle = '#495057';
    ctx.font = `${Math.round(pitch * 0.45)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const top = Math.min(...points.map((p) => p.y));
    const cx = (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2;
    ctx.fillText(
      label,
      cx,
      top - pitch * (def.kind === 'led' ? 1.25 : def.kind === 'chip' ? 0.5 : 0.6),
    );
  }
  ctx.restore();
}
