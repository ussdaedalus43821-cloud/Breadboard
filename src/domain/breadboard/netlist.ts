// Netlist: which terminals are electrically joined. See docs/ARCHITECTURE.md §4.
// Built once from a board spec plus explicit connections, then immutable.

import { boardConnections, boardTerminals, isOnBoard, type BoardSpec } from './spec';
import { parseTerminal, terminalKey, type TerminalKey, type TerminalRef } from './terminal';

export * from './terminal';

/** Disjoint-set forest over string keys, with path halving and union by size. */
export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();

  add(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.size.set(key, 1);
    }
  }

  has(key: string): boolean {
    return this.parent.has(key);
  }

  find(key: string): string {
    let node = key;
    let up = this.parent.get(node);
    if (up === undefined) throw new RangeError(`unknown key: ${key}`);
    while (up !== node) {
      const grand = this.parent.get(up)!;
      this.parent.set(node, grand);
      node = grand;
      up = this.parent.get(node)!;
    }
    return node;
  }

  union(a: string, b: string): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size.get(ra)! < this.size.get(rb)!) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    this.size.set(ra, this.size.get(ra)! + this.size.get(rb)!);
  }

  keys(): IterableIterator<string> {
    return this.parent.keys();
  }
}

/** `net:` + the smallest terminal key in the net; deterministic across builds. */
export type NetId = string;

export interface Net {
  readonly id: NetId;
  /** Sorted canonical keys. */
  readonly terminals: readonly TerminalKey[];
}

export interface NetlistInput {
  /** Pairs of terminals joined by something other than the board (pin-in-hole, wire). */
  readonly connections?: ReadonlyArray<readonly [TerminalRef, TerminalRef]>;
  /** Extra terminals (normally part pins) to register even if nothing joins them. */
  readonly terminals?: readonly TerminalRef[];
}

export class UnknownTerminalError extends RangeError {
  override name = 'UnknownTerminalError';
}

export interface Netlist {
  readonly spec: BoardSpec;
  /** All nets, sorted by id. */
  readonly nets: readonly Net[];
  has(ref: TerminalRef): boolean;
  netOf(ref: TerminalRef): NetId;
  /** Every terminal joined to `ref` (including `ref`), sorted by key. */
  resolveNet(ref: TerminalRef): TerminalRef[];
  connected(a: TerminalRef, b: TerminalRef): boolean;
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildNetlist(spec: BoardSpec, input: NetlistInput = {}): Netlist {
  const uf = new UnionFind();
  for (const t of boardTerminals(spec)) uf.add(terminalKey(t));
  for (const group of boardConnections(spec)) {
    const [first, ...rest] = group.map(terminalKey);
    for (const k of rest) uf.union(first!, k);
  }

  const register = (ref: TerminalRef): string => {
    const key = terminalKey(ref);
    if (ref.kind === 'pin') {
      uf.add(key);
    } else if (!isOnBoard(spec, ref)) {
      throw new UnknownTerminalError(`${key} is not on this ${spec.size} board`);
    }
    return key;
  };
  for (const t of input.terminals ?? []) register(t);
  for (const [a, b] of input.connections ?? []) uf.union(register(a), register(b));

  const members = new Map<string, string[]>();
  for (const key of uf.keys()) {
    const root = uf.find(key);
    let list = members.get(root);
    if (!list) members.set(root, (list = []));
    list.push(key);
  }

  const netByKey = new Map<TerminalKey, Net>();
  const nets: Net[] = [];
  for (const list of members.values()) {
    list.sort(byKey);
    const net: Net = { id: `net:${list[0]!}`, terminals: list };
    nets.push(net);
    for (const key of list) netByKey.set(key, net);
  }
  nets.sort((a, b) => byKey(a.id, b.id));

  const lookup = (ref: TerminalRef): Net => {
    const key = terminalKey(ref);
    const net = netByKey.get(key);
    if (!net) throw new UnknownTerminalError(`${key} is not in this netlist`);
    return net;
  };

  return {
    spec,
    nets,
    has: (ref) => netByKey.has(terminalKey(ref)),
    netOf: (ref) => lookup(ref).id,
    resolveNet: (ref) => lookup(ref).terminals.map(parseTerminal),
    connected: (a, b) => lookup(a) === lookup(b),
  };
}
