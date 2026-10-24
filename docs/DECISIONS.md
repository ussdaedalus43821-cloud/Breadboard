# Decisions

A log of decisions that shape the code, with the reason for each, so nobody
has to re-derive them after a long gap. Newest at the bottom. To reverse a
decision, add a new entry that supersedes it; do not edit history.

Status: **Accepted** (in force), **Open** (needs a call from the project
owner), **Superseded by D-NNN**.

## D-001 — Stack (Accepted, Phase 0)

Vite + TypeScript + Vitest, Canvas 2D, the sim in a Web Worker, NovaLang
under Pyodide in a second lazily loaded worker. Set by the project brief.
Not to be re-litigated.

## D-002 — Half-size board by default (Accepted, Phase 0)

30 rows, 400 tie points. `boardSpec('full')` gives 63 rows, 830 tie points,
with a `splitRails` option. Nothing outside `spec.ts` assumes a row count.

## D-003 — Vendor NovaLang into `public/nova/` (Accepted, Phase 0; done in Phase 4.5)

`novalang.py`, `bootstrap.py`, `novalang.nova`, `lib/` plus a `VERSION`
file naming the source commit, so the game is self-contained. The NovaLang
repo itself is not modified.

## D-004 — TerminalRef keys are prefixed strings (Accepted, Phase 0)

`hole:e15`, `rail:top+:3`, `pin:U1:14`. There is no shorthand (`e15`) so a
key's kind is never ambiguous. `terminalKey` and `parseTerminal` are the
only converters.

## D-005 — `board.set` is the 10th bridge command (Accepted, Phase 0)

The brief listed nine commands with no way to flip a switch, which makes a
truth-table script impossible. `board.set(part, value)` fills that gap and
stays inside the ~10-command cap.

## D-006 — Synchronous bridge over SharedArrayBuffer + Atomics (Accepted, Phase 0)

NovaLang scripts are synchronous (`board.run(1)` then `sim.get(...)`). The
nova worker blocks in `Atomics.wait` for the sim worker's reply. This
requires cross-origin isolation (COOP/COEP headers), which `vite.config.ts`
sets for dev and preview. Production hosting must send them too.

## D-007 — ESLint pinned to 9 (Accepted, Phase 0)

`eslint-plugin-import` (`import/no-restricted-paths`, the `domain/`
isolation rule) does not support ESLint 10 yet. Revisit when it does.

## D-008 — `npm install` needs the proxy bypass cleared (Accepted, Phase 0)

In the cloud dev environment `registry.npmjs.org` is on the proxy-bypass
list but does not resolve directly. Run installs as
`npm_config_noproxy="" NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npm install`.
This is environment-only; nothing in the repo depends on it.

## D-009 — Column `a` nearest the viewer (Accepted, Phase 1)

Phase 0 drew `a` at the top. A DIP with pin 1 in column `e` then came out
as a mirror image of the real chip (clockwise numbering). Flipping the
drawing (`j` top, `a` bottom, as on most real boards) makes a chip at `e`
read like the real part: notch left, pin 1 bottom-left, counterclockwise.
Only `COLUMN_Y` in `spec.ts` changed. Connectivity and TerminalRefs did
not.

## D-010 — Interim main-thread CircuitHost in Phase 1 (Accepted, Phase 1)

There is no sim worker before Phase 2, but the UI must already behave as a
client of it. The UI talks only to `CircuitHost`
(`src/protocol/circuit-host.ts`): `apply(cmd): Promise<HostResult>` plus
`subscribe`. Phase 1 implements it with `LocalCircuitHost`, which runs the
pure `applyCommand` dispatcher on the main thread and JSON round-trips
every command. Phase 2 replaces it with a sim-worker client behind the
same interface and deletes `local-circuit-host.ts`. Editing the circuit is
not simulation, so this does not break ARCHITECTURE §2 rule 3 even in the
interim.

## D-011 — One lead per hole; a wire "to a pin" uses the nearest joined free hole (Accepted, Phase 1)

Each hole holds one pin or one wire end, as on a real board. The Phase 0
text said a wire to a pin is "normalized to the hole that pin occupies",
which contradicts that rule. Instead the dispatcher picks the nearest free
hole in the same row strip or rail line, which is electrically the same
point. Updated in ARCHITECTURE §4 and NOVALANG_BRIDGE §2 (`board.wire`),
before the bridge exists, so no contract version bump.

## D-012 — Phase 1 palette has an SPST switch; the bridge says SPDT (Open)

The Phase 1 brief asked for an SPST switch (`switch-spst`, pins `1`/`2`).
NOVALANG_BRIDGE §2 specifies `board.switch(at)` as a 3-pin SPDT
(`a`/`com`/`b`, position 0/1), which is the more useful part for logic
inputs (it drives a firm 0 or 1 with no pull resistor). Options: (a) add
`switch-spdt` to the registry in Phase 2 and keep the contract, or (b)
change the contract to SPST plus a pull resistor. **Proposed: (a).**

## D-013 — No rotation in Phase 1; flexible leads use default spacing (Accepted, Phase 1)

Click-to-place drops each part's default footprint with the anchor pin at
the clicked hole (LED leads 0.1" apart, resistor 0.4"). The `placeLeads`
command already accepts any holes for LEDs and resistors. Drag-to-bend
leads and rotation are UI work for a later phase.

## D-014 — Part `type` ids (Accepted, Phase 1)

`led-red`, `resistor`, `switch-spst`, `chip74hc00`. Chip ids are `chip` +
part number with no separators. The ARCHITECTURE save-format example's
`chip7400` and `switch-spdt` follow the same scheme and arrive in Phases
3 and 2.
