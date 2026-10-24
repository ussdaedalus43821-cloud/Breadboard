// Part definitions are data. See docs/ARCHITECTURE.md §2 (domain/parts).

import type { ColumnLetter, TerminalKey } from '../breadboard/terminal';
import type { BoardTerminal } from '../breadboard/spec';
import type { ChipLogic } from '../chips/gate';

/**
 * What a pin does electrically. `input` pins must not float; `output` pins
 * drive their net (chip logic, Phase 3); `power`/`ground` feed a chip;
 * `passive` pins belong to two-terminal parts and switches.
 */
export type PinRole = 'input' | 'output' | 'power' | 'ground' | 'passive';

/** One pin of a part's default footprint, as a pitch offset from the anchor pin's hole. */
export interface PinFootprint {
  readonly pin: string;
  readonly dx: number;
  readonly dy: number;
  /** Defaults to `passive`. */
  readonly role?: PinRole;
  /** Datasheet name, e.g. `1A`, `1Y`, `VCC`. */
  readonly name?: string;
}

export type PartKind = 'led' | 'resistor' | 'switch' | 'chip';

export interface PartDef {
  /** Registry key, also the `type` in saves and the bridge (e.g. `led-red`). */
  readonly type: string;
  readonly kind: PartKind;
  /** Human name for the palette and inspector. */
  readonly label: string;
  /** Prefix for generated part ids: `D` → D1, D2, … */
  readonly idPrefix: string;
  /**
   * Default footprint. The first entry is the anchor (its offset is 0,0);
   * clicking a hole places the anchor there.
   */
  readonly pins: readonly PinFootprint[];
  /**
   * `fixed`: the footprint is rigid (DIP packages, switches).
   * `flexible`: leads can bend to any holes (LEDs, resistors); the footprint
   * is only the default spacing used by click-to-place.
   */
  readonly leads: 'fixed' | 'flexible';
  /** If set, the anchor pin must sit in one of these columns (a DIP straddles the channel). */
  readonly anchorColumns?: readonly ColumnLetter[];
  /** Static electrical properties; read by the sim from Phase 2 on. */
  readonly props: Readonly<Record<string, string | number>>;
  /** Logic chips only: gates, supply pins, propagation delay (domain/chips). */
  readonly logic?: ChipLogic;
}

/** A part on the board. Every pin maps to the board terminal (hole or rail hole) it sits in. */
export interface PlacedPart {
  readonly id: string;
  readonly type: string;
  readonly pins: Readonly<Record<string, BoardTerminal>>;
  /** User-set state, e.g. `{ position: 1 }` for a switch. Saved; everything else is derived. */
  readonly state?: Readonly<Record<string, number>>;
}

/** JSON form of a PlacedPart: TerminalRefs as canonical keys. */
export interface PlacedPartJson {
  readonly id: string;
  readonly type: string;
  readonly pins: Readonly<Record<string, TerminalKey>>;
}
