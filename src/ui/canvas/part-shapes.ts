// Simple shapes for parts and wires: a body plus a dot on every pin.

import {
  terminalPosition,
  type BoardSpec,
  type BoardTerminal,
  type Point,
} from '../../domain/breadboard/spec';
import type { Supply, Wire } from '../../domain/circuit/circuit';
import type { PartDef } from '../../domain/parts/types';
import type { Level } from '../../domain/sim/solver';
import type { BoardLayout } from './board-layout';

const WIRE_COLORS = ['#e8a33d', '#2f9e44', '#1c7ed6', '#c92a2a', '#7048e8', '#212529'];
const PIN = '#c0c4c8';
const PIN_EDGE = '#5c636a';
const INVALID = '#e03131';
const WARN = '#fab005';

/** Pin-dot fill per logic level: high red, low blue, contention purple, floating silver. */
const LEVEL_COLOR: Record<Level, string> = { 1: '#ff6b6b', 0: '#4dabf7', X: '#cc5de8', Z: PIN };

export interface DrawStyle {
  /** Ghost preview: translucent. */
  readonly ghost?: boolean;
  /** Ghost that cannot be placed here. */
  readonly invalid?: boolean;
  /** Level of the net at a pin (by pin name for parts, `from`/`to` for wires). */
  readonly levelOf?: (pin: string) => Level | undefined;
  /** Pin names with an active warning: ringed in yellow. */
  readonly warn?: ReadonlySet<string>;
  /** LED: lit. */
  readonly lit?: boolean;
  /** LED: glow, 0…1 of its rated current. */
  readonly brightness?: number;
  /** LED: destroyed by over-current. */
  readonly burnt?: boolean;
  /** Switch: position (SPST 1 = closed; SPDT 0 = com–a, 1 = com–b). */
  readonly position?: number;
}

const BAND_COLORS = [
  '#1b1b1b', // 0 black
  '#7c4a1e', // 1 brown
  '#d6332e', // 2 red
  '#f08c00', // 3 orange
  '#f5d90a', // 4 yellow
  '#2f9e44', // 5 green
  '#1c7ed6', // 6 blue
  '#7048e8', // 7 violet
  '#868e96', // 8 grey
  '#f8f9fa', // 9 white
];

/** The three value bands of a 4-band resistor: 330 → orange orange brown, 10 k → brown black orange. */
export function resistorBands(ohms: number): [string, string, string] {
  let sig = ohms;
  let exp = 0;
  while (sig >= 100) {
    sig /= 10;
    exp++;
  }
  const d = Math.round(sig);
  return [BAND_COLORS[Math.floor(d / 10)]!, BAND_COLORS[d % 10]!, BAND_COLORS[exp]!];
}

/** Linear blend of two #rrggbb colours. */
function mix(from: string, to: string, t: number): string {
  const c = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const ch = [0, 1, 2].map((i) => Math.round(c(from, i) + (c(to, i) - c(from, i)) * t));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

function px(spec: BoardSpec, layout: BoardLayout, t: BoardTerminal): Point {
  return layout.toPixel(terminalPosition(spec, t));
}

function pinDot(
  ctx: CanvasRenderingContext2D,
  p: Point,
  r: number,
  invalid: boolean,
  level?: Level,
  warn = false,
): void {
  if (warn) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
    ctx.strokeStyle = WARN;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = invalid ? INVALID : level === undefined ? PIN : LEVEL_COLOR[level];
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
  pinDot(ctx, a, pitch * 0.14, false, style.levelOf?.('from'));
  pinDot(ctx, b, pitch * 0.14, false, style.levelOf?.('to'));
  ctx.restore();
}

/** A bench-supply lead: a tag beside the hole it is plugged into. */
export function drawSupply(
  ctx: CanvasRenderingContext2D,
  spec: BoardSpec,
  layout: BoardLayout,
  supply: Supply,
): void {
  const p = px(spec, layout, supply.at);
  const pitch = layout.pitchPx;
  const power = supply.kind === 'power';
  // Sized to fit in the board margin left of rail hole 1.
  const lead = pitch * 0.5;
  const w = pitch * 1.35;
  const h = pitch * 0.7;
  ctx.save();
  ctx.strokeStyle = power ? '#c92a2a' : '#212529';
  ctx.lineWidth = pitch * 0.2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - lead, p.y);
  ctx.stroke();
  ctx.fillStyle = power ? '#c92a2a' : '#212529';
  ctx.beginPath();
  ctx.roundRect(p.x - lead - w, p.y - h / 2, w, h, h / 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(pitch * 0.38)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(power ? '+5V' : 'GND', p.x - lead - w / 2, p.y);
  pinDot(ctx, p, pitch * 0.17, false, power ? 1 : 0);
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
      const r = pitch * 0.55;
      lead(ctx, a, mid, 2);
      lead(ctx, k, mid, 2);
      if (style.burnt) {
        // Burnt: dark, cracked, no glow.
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#3d3a3a';
        ctx.fill();
        ctx.strokeStyle = '#1f1d1d';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = '#c9c2b8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mid.x - r * 0.55, mid.y - r * 0.45);
        ctx.lineTo(mid.x - r * 0.05, mid.y + r * 0.05);
        ctx.lineTo(mid.x + r * 0.1, mid.y - r * 0.3);
        ctx.lineTo(mid.x + r * 0.55, mid.y + r * 0.5);
        ctx.stroke();
        break;
      }
      // Glow scales with current: a dim LED barely haloes, one at its rating blazes.
      const glow = style.lit ? 0.35 + 0.65 * (style.brightness ?? 1) : 0;
      if (glow > 0) {
        ctx.shadowColor = `rgba(255, 45, 45, ${glow})`;
        ctx.shadowBlur = pitch * 1.6 * glow;
      }
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
      ctx.fillStyle = style.lit
        ? mix('#8a2f33', '#ff4d4f', glow)
        : style.ghost
          ? '#e5484d'
          : '#8a2f33';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#8f1d22';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (style.lit) {
        ctx.beginPath();
        ctx.arc(mid.x - pitch * 0.17, mid.y - pitch * 0.17, pitch * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 227, 227, ${glow})`;
        ctx.fill();
      }
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
      // Colour code from the value: digit, digit, multiplier, gold tolerance.
      [...resistorBands(Number(def.props['ohms'])), '#c9a227'].forEach((color, i) => {
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
        // Slider knob: left at position 0, right at position 1.
        const on = (style.position ?? 0) === 1;
        const w = (x1 - x0) * 0.3;
        const kx = on ? x1 - (x1 - x0) * 0.15 - w : x0 + (x1 - x0) * 0.15;
        ctx.fillStyle = def.type === 'switch-spst' && on ? '#69db7c' : '#f1f3f5';
        ctx.fillRect(kx, y0 + (y1 - y0) * 0.25, w, (y1 - y0) * 0.5);
      }
      break;
    }
  }
  ctx.restore();

  ctx.save();
  if (style.ghost) ctx.globalAlpha = 0.6;
  for (const [name, t] of Object.entries(pins)) {
    pinDot(
      ctx,
      px(spec, layout, t),
      pitch * 0.17,
      invalid,
      style.levelOf?.(name),
      style.warn?.has(name) ?? false,
    );
  }
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
