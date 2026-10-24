// Editor interaction state: palette tool, hover, click-to-place, drag-to-wire,
// click-to-toggle switches, right-click remove. Works in board terminals and
// pitch points, not pixels, so it is testable without a DOM; the canvas layer
// converts pointer events.

import type { BoardTerminal, Point } from '../../domain/breadboard/spec';
import { pin, terminalKey, type TerminalKey } from '../../domain/breadboard/terminal';
import { occupancy, occupantId, partAtPoint, type Circuit } from '../../domain/circuit/circuit';
import { applyCommand, type Command } from '../../domain/circuit/commands';
import { footprintAt } from '../../domain/parts/footprint';
import { getPartDef } from '../../domain/parts/registry';
import type { Level } from '../../domain/sim/solver';
import type { CircuitHost, SimFrame } from '../../protocol/circuit-host';

export type Tool =
  | { readonly kind: 'select' }
  | { readonly kind: 'part'; readonly type: string }
  | { readonly kind: 'wire' }
  | { readonly kind: 'supply'; readonly supply: 'power' | 'ground' };

/** What the renderer should draw on top of the circuit. */
export type Preview =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'part';
      readonly type: string;
      readonly pins: Readonly<Record<string, BoardTerminal>> | null;
      readonly valid: boolean;
    }
  | {
      readonly kind: 'wire';
      readonly from: BoardTerminal;
      readonly to: BoardTerminal | null;
      readonly valid: boolean;
    };

export class Editor {
  tool: Tool = { kind: 'select' };
  hover: BoardTerminal | null = null;
  /** Status line text: last result or a hint. */
  message = 'Pick a part from the palette, then click a hole.';
  private dragFrom: BoardTerminal | null = null;
  private circuit: Circuit | null = null;
  private latest: SimFrame | null = null;
  private levels = new Map<TerminalKey, { net: string; level: Level; volts: number | null }>();

  constructor(
    private readonly host: CircuitHost,
    private readonly onChange: () => void = () => {},
  ) {
    host.subscribe((c) => {
      this.circuit = c;
      this.onChange();
    });
    host.subscribeFrames((f) => {
      this.latest = f;
      this.levels = new Map();
      for (const net of f.nets) {
        for (const key of net.terminals) {
          this.levels.set(key, { net: net.id, level: net.level, volts: net.volts });
        }
      }
      this.onChange();
    });
  }

  get current(): Circuit {
    if (!this.circuit) throw new Error('Editor used before the circuit host was ready');
    return this.circuit;
  }

  get frame(): SimFrame | null {
    return this.latest;
  }

  /** Level of the net a terminal is on, per the latest frame. */
  levelOf(key: TerminalKey): Level | undefined {
    return this.levels.get(key)?.level;
  }

  /** One line about the hovered hole: its key, what is in it, its net and level. */
  hoverInfo(): string {
    if (!this.hover || !this.circuit) return '';
    const key = terminalKey(this.hover);
    const who = occupancy(this.circuit).get(key);
    const what = !who
      ? ''
      : who.kind === 'pin'
        ? ` · ${terminalKey(pin(who.part, who.pin))}`
        : ` · ${occupantId(who)}`;
    const lv = this.levels.get(key);
    if (!lv) return `${key}${what}`;
    const volts = lv.volts === null ? '' : ` · ${lv.volts.toFixed(2)} V`;
    const partId = who?.kind === 'pin' ? who.part : undefined;
    const part = partId === undefined ? undefined : this.latest?.parts[partId];
    const current =
      part?.burnt === true
        ? ` · ${partId} burnt out`
        : part?.milliamps !== undefined
          ? ` · ${partId} ${Math.abs(part.milliamps).toFixed(1)} mA`
          : '';
    return `${key}${what} · ${lv.net} · level ${lv.level}${volts}${current}`;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.dragFrom = null;
    this.message =
      tool.kind === 'part'
        ? `${getPartDef(tool.type).label}: click a hole to place it.`
        : tool.kind === 'wire'
          ? 'Wire: drag from one hole to another.'
          : tool.kind === 'supply'
            ? `${tool.supply === 'power' ? '+5 V' : 'Ground'} lead: click a hole (normally a rail).`
            : 'Select: click a switch to flip it; right-click a lead to remove its part or wire.';
    this.onChange();
  }

  /** Show a status message. */
  say(message: string): void {
    this.message = message;
    this.onChange();
  }

  pointerMove(t: BoardTerminal | null): void {
    this.hover = t;
    this.onChange();
  }

  /** `point` is the pointer in pitch coordinates, for clicks on part bodies. */
  async pointerDown(t: BoardTerminal | null, point?: Point): Promise<void> {
    const tool = this.tool;
    if (tool.kind === 'select') {
      await this.toggleAt(t, point);
      return;
    }
    if (!t) return;
    if (tool.kind === 'part') {
      await this.run({ op: 'place', type: tool.type, at: terminalKey(t) }, 'Placed');
    } else if (tool.kind === 'supply') {
      await this.run({ op: tool.supply, at: terminalKey(t) }, 'Connected');
    } else {
      this.dragFrom = t;
      this.onChange();
    }
  }

  async pointerUp(t: BoardTerminal | null): Promise<void> {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (this.tool.kind !== 'wire' || !from) return;
    if (!t || terminalKey(t) === terminalKey(from)) {
      this.onChange();
      return;
    }
    await this.run({ op: 'wire', from: this.wireEnd(from), to: this.wireEnd(t) }, 'Wired');
  }

  /** Right-click: remove whatever part, wire or supply has a lead in `t`. */
  async removeAt(t: BoardTerminal | null): Promise<void> {
    if (!t) return;
    const who = occupancy(this.current).get(terminalKey(t));
    if (!who) return;
    await this.run({ op: 'remove', id: occupantId(who) }, 'Removed');
  }

  preview(): Preview {
    const c = this.circuit;
    if (!c) return { kind: 'none' };
    if (this.tool.kind === 'part' && this.hover) {
      const fp = footprintAt(c.spec, getPartDef(this.tool.type), this.hover);
      const valid = applyCommand(c, {
        op: 'place',
        type: this.tool.type,
        at: terminalKey(this.hover),
      }).ok;
      return { kind: 'part', type: this.tool.type, pins: fp.ok ? fp.pins : null, valid };
    }
    if (this.tool.kind === 'wire' && this.dragFrom) {
      const to = this.hover;
      const valid =
        !!to &&
        applyCommand(c, { op: 'wire', from: this.wireEnd(this.dragFrom), to: this.wireEnd(to) }).ok;
      return { kind: 'wire', from: this.dragFrom, to, valid };
    }
    return { kind: 'none' };
  }

  /** Flip the switch whose pin is in `t`, or whose body is under `point`. */
  private async toggleAt(t: BoardTerminal | null, point?: Point): Promise<void> {
    const c = this.current;
    const who = t ? occupancy(c).get(terminalKey(t)) : undefined;
    const part =
      who?.kind === 'pin'
        ? c.parts.find((p) => p.id === who.part)
        : point
          ? partAtPoint(c, point.x, point.y)
          : undefined;
    if (!part || getPartDef(part.type).kind !== 'switch') return;
    const next = (part.state?.['position'] ?? 0) === 1 ? 0 : 1;
    const r = await this.host.apply({ op: 'set', id: part.id, value: next });
    const label = part.type === 'switch-spst' ? (next ? 'closed' : 'open') : `position ${next}`;
    this.message = r.ok ? `${part.id} ${label}.` : `${r.error.code}: ${r.error.message}`;
    this.onChange();
  }

  /** A hole holding a part pin is wired "to that pin"; the dispatcher picks the free hole. */
  private wireEnd(t: BoardTerminal): TerminalKey {
    const who = occupancy(this.current).get(terminalKey(t));
    return terminalKey(who?.kind === 'pin' ? pin(who.part, who.pin) : t);
  }

  private async run(cmd: Command, verb: string): Promise<void> {
    const r = await this.host.apply(cmd);
    this.message = r.ok ? `${verb} ${r.id}.` : `${r.error.code}: ${r.error.message}`;
    this.onChange();
  }
}
