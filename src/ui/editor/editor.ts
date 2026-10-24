// Editor interaction state: palette tool, hover, click-to-place, drag-to-wire,
// right-click remove. Works in board terminals, not pixels, so it is testable
// without a DOM; the canvas layer converts pointer events to terminals.

import type { BoardTerminal } from '../../domain/breadboard/spec';
import { pin, terminalKey, type TerminalKey } from '../../domain/breadboard/terminal';
import { occupancy, type Circuit } from '../../domain/circuit/circuit';
import { applyCommand, type Command } from '../../domain/circuit/commands';
import { footprintAt } from '../../domain/parts/footprint';
import { getPartDef } from '../../domain/parts/registry';
import type { CircuitHost } from '../../protocol/circuit-host';

export type Tool =
  | { readonly kind: 'select' }
  | { readonly kind: 'part'; readonly type: string }
  | { readonly kind: 'wire' };

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
  private circuit!: Circuit;

  constructor(
    private readonly host: CircuitHost,
    private readonly onChange: () => void = () => {},
  ) {
    host.subscribe((c) => {
      this.circuit = c;
      this.onChange();
    });
  }

  get current(): Circuit {
    return this.circuit;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.dragFrom = null;
    this.message =
      tool.kind === 'part'
        ? `${getPartDef(tool.type).label}: click a hole to place it.`
        : tool.kind === 'wire'
          ? 'Wire: drag from one hole to another.'
          : 'Select: right-click a part or wire to remove it.';
    this.onChange();
  }

  pointerMove(t: BoardTerminal | null): void {
    this.hover = t;
    this.onChange();
  }

  async pointerDown(t: BoardTerminal | null): Promise<void> {
    if (!t) return;
    if (this.tool.kind === 'part') {
      await this.run({ op: 'place', type: this.tool.type, at: terminalKey(t) }, 'Placed');
    } else if (this.tool.kind === 'wire') {
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

  /** Right-click: remove whatever part or wire has a lead in `t`. */
  async removeAt(t: BoardTerminal | null): Promise<void> {
    if (!t) return;
    const who = occupancy(this.circuit).get(terminalKey(t));
    if (!who) return;
    await this.run({ op: 'remove', id: who.kind === 'pin' ? who.part : who.wire }, 'Removed');
  }

  preview(): Preview {
    const c = this.circuit;
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

  /** A hole holding a part pin is wired "to that pin"; the dispatcher picks the free hole. */
  private wireEnd(t: BoardTerminal): TerminalKey {
    const who = occupancy(this.circuit).get(terminalKey(t));
    return terminalKey(who?.kind === 'pin' ? pin(who.part, who.pin) : t);
  }

  private async run(cmd: Command, verb: string): Promise<void> {
    const r = await this.host.apply(cmd);
    this.message = r.ok ? `${verb} ${r.id}.` : `${r.error.code}: ${r.error.message}`;
    this.onChange();
  }
}
