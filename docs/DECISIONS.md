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

## D-010 — Interim main-thread CircuitHost in Phase 1 (Superseded by D-015)

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

## D-012 — Phase 1 palette has an SPST switch; the bridge says SPDT (Accepted: option (a), Phase 2)

The Phase 1 brief asked for an SPST switch (`switch-spst`, pins `1`/`2`).
NOVALANG_BRIDGE §2 specifies `board.switch(at)` as a 3-pin SPDT
(`a`/`com`/`b`, position 0/1), which is the more useful part for logic
inputs (it drives a firm 0 or 1 with no pull resistor). Options: (a) add
`switch-spdt` to the registry in Phase 2 and keep the contract, or (b)
change the contract to SPST plus a pull resistor. **Proposed: (a).**

**Resolved (Phase 2): option (a), approved by the project owner.**
`switch-spdt` (pins `a`, `com`, `b` in consecutive rows) is in the
registry, so the bridge contract stands as written. The visual palette
keeps only the SPST for now.

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

## D-015 — SimService served over any port; LocalCircuitHost deleted (Accepted, Phase 2)

The sim worker's logic is `SimService` (`src/worker/sim-service.ts`). It
has no worker globals, and `serveSim(port)` attaches it to anything with
`postMessage`/`onmessage`. `sim.worker.ts` serves it on the worker global.
Tests serve it on one end of a real `MessageChannel` and connect the real
`WorkerCircuitHost` to the other (`tests/support/in-process-host.ts`), so
the editor tests exercise the exact browser protocol path minus the
Worker. The interim `LocalCircuitHost` from D-010 is deleted. The editor
still runs `applyCommand` on its read-only mirror of the circuit to colour
the ghost preview. That is validation, not simulation.

## D-016 — Stage-1 is static; no tick loop yet (Accepted, Phase 2)

Switches, supplies, resistors and LEDs have no dynamics, so Phase 2
re-solves the whole circuit after every edit (cheap: well under a
millisecond at this size). A tick loop and sim time are added with gate
propagation delay in Phase 3, which is also when `board.run`/`board.step`
start to mean something. Frames carry a `revision`, not a time.

## D-017 — Resistors pass weak levels; LEDs are loads; dividers are X (Accepted, Phase 2)

Stage 1 has no voltages, but "switch → resistor → LED" must light, and a
pull-up must count as a driven input. Resistors therefore copy a strong
level onto undriven nets as a weak level. An undriven resistor-joined
group that sees both 0 and 1 is `X`. LEDs never drive. Stage 2 (Phase 4)
replaces this with real currents and keeps the same `Level` type.

## D-018 — The editor starts on a powered "bench" board (Accepted, Phase 2)

The UI starts from `benchCircuit()`: +5 V leads on `top+`/`bottom+` and
ground leads on `top-`/`bottom-` at hole 1 (and at the first hole of each
half when rails are split). Supply leads are ordinary circuit entries
(`power`/`ground` commands, ids `VCC<n>`/`GND<n>`, one lead per hole, and
removable). The palette has `+5V lead` and `GND lead` tools for adding
more. The bridge's `board.new` starts from `emptyCircuit()`, so scripts
call `board.power`/`board.ground` themselves, as the contract says.

## D-019 — Switch state is `position` 0/1, changed by the `set` command (Accepted, Phase 2)

Both switch types store `state: { position }` on the PlacedPart (SPST 1 =
closed; SPDT 0 = com–a, 1 = com–b), which matches `board.set(part,
value)` and the save format. `set` is an ordinary edit command, so it goes
through the same dispatcher and triggers a re-solve. In the editor's
Select tool, clicking a switch's body or pin flips it.

## D-020 — Pin roles are data; the 74HC00 has them before it has logic (Accepted, Phase 2)

`PinFootprint` gained optional `role` and datasheet `name`. The 74HC00's
inputs, outputs and supply pins are declared now (one shared quad-2-input
pinout table) so floating-input and unpowered-chip warnings work in Phase 2. Its outputs drive nothing until Phase 3 gives it logic.
