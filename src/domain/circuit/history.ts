// Undo/redo over immutable Circuit values. An entry is the circuit as it was
// before an edit, plus a label for the UI. A group (a script run) collapses
// many edits into one entry.

import type { Circuit } from './circuit';

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What Undo would undo, e.g. "place D1". */
  readonly undoLabel?: string;
  readonly redoLabel?: string;
}

interface Entry {
  readonly circuit: Circuit;
  readonly label: string;
}

export class History {
  private undos: Entry[] = [];
  private redos: Entry[] = [];
  private group: Entry | null = null;

  constructor(private readonly limit = 200) {}

  get grouping(): boolean {
    return this.group !== null;
  }

  get state(): HistoryState {
    const u = this.undos.at(-1);
    const r = this.redos.at(-1);
    return {
      canUndo: u !== undefined,
      canRedo: r !== undefined,
      ...(u ? { undoLabel: u.label } : {}),
      ...(r ? { redoLabel: r.label } : {}),
    };
  }

  /** An edit is about to replace `before`. Inside a group this is a no-op. */
  record(before: Circuit, label: string): void {
    if (this.group) return;
    this.push(before, label);
  }

  /** Start a group; `current` is what one undo will return to. */
  begin(current: Circuit, label: string): void {
    this.group ??= { circuit: current, label };
  }

  /** Close the group. Returns true if it changed anything (and so became an entry). */
  end(current: Circuit): boolean {
    const g = this.group;
    this.group = null;
    if (!g || g.circuit === current) return false;
    this.push(g.circuit, g.label);
    return true;
  }

  undo(current: Circuit): Entry | null {
    const e = this.undos.pop();
    if (!e) return null;
    this.redos.push({ circuit: current, label: e.label });
    return e;
  }

  redo(current: Circuit): Entry | null {
    const e = this.redos.pop();
    if (!e) return null;
    this.undos.push({ circuit: current, label: e.label });
    return e;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
    this.group = null;
  }

  private push(circuit: Circuit, label: string): void {
    this.undos.push({ circuit, label });
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }
}
