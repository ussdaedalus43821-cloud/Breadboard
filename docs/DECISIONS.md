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

## D-003 — Vendor NovaLang into `public/nova/` (Accepted, Phase 0; refined by D-030)

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

## D-016 — Stage-1 is static; no tick loop yet (Superseded by D-021, D-023)

Switches, supplies, resistors and LEDs have no dynamics, so Phase 2
re-solves the whole circuit after every edit (cheap: well under a
millisecond at this size). A tick loop and sim time are added with gate
propagation delay in Phase 3, which is also when `board.run`/`board.step`
start to mean something. Frames carry a `revision`, not a time.

## D-017 — Resistors pass weak levels; LEDs are loads; dividers are X (Superseded by D-025, D-026)

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

## D-021 — 1 tick = 1 ms; every 74HC gate has a 1-tick inertial delay (Accepted, Phase 3)

The brief fixed the tick at 1 kHz. Real 74HC propagation delay (~8 ns) is
far below a tick, so each gate gets `delayTicks = 1`, the smallest
observable delay. A signal through n gates takes n ticks, which makes delay
visible and testable (see the half-adder timeline in
`tests/acceptance/phase3.test.ts`). The delay is **inertial**: a change
cancelled before it lands is dropped, so a sub-tick input pulse never
reaches an output, much like real CMOS. `delayTicks` is per chip, so
slower parts (or a 74LS family) can differ later.

## D-022 — Half adder on one 74HC00: the carry LED sinks into NAND(A, B) (Accepted, Phase 3)

A driven half adder needs five NANDs (four for XOR, one more to invert
the carry). The brief asked for one 74HC00, which has four. The XOR's first
gate already computes n1 = NAND(A, B) = NOT carry, so the carry LED is
wired as a current sink: +5 V → R4 → D2 → n1. It lights exactly when
n1 = 0, i.e. A = B = 1. This is ordinary practice with real 74HC outputs.
The SPST switches leave inputs floating when open, so each gets a
pull-down resistor. The circuit uses only default footprints, so it can be
built by hand from the palette. `src/domain/demos/half-adder.ts` is the
single definition, used by the browser's demo button and the acceptance
test.

## D-023 — Real-time loop lives at the edge; tests never see wall time (Accepted, Phase 3)

`SimService.advance(elapsedMs)` owes one tick per elapsed ms and is called
from a ~4 ms `setInterval` that `serveSim` installs only when given a
`Clock`. Catch-up is capped at 250 ticks per call, so a throttled or
backgrounded tab loses time rather than freezing to replay it. The clock
starts paused, and the editor starts it after connecting. Pausing plus
**Step 1 ms** makes gate delay visible in the browser. Scripts (Phase 4.5)
will pause the clock and drive time only with `board.run`/`board.step`, so
their results do not depend on wall time.

## D-024 — 74HC02, 74HC04 and 74HC08 ship with the builder (Accepted, Phase 3)

The original phase plan listed the 7400 first, then the 7402/7404/7408
from the same builder. With `gateChip`, each is one line plus its pinout
table (the 7402's outputs come first on each side; the 7404 has six
inverters), and each has a truth-table test on the board. All four chips
are in the palette.

## D-025 — Stage 2 is DC nodal analysis with Thevenin drivers and piecewise-linear LEDs (Accepted, Phase 4)

Every driver is a voltage source behind a resistance: the bench supply is
5 V / 0.1 Ω, and a 74HC output is 0 or 5 V / 50 Ω (roughly the typical HC
output at 5 V). Resistors are conductances. LEDs are off, or 2.0 V + 15 Ω.
The solver builds the nodal matrix over the nets that touch an element,
solves it densely (circuits have tens of nodes), and iterates LED states
until consistent. Limits, contention, burn-out and LED brightness all fall
out of the same currents rather than being special cases. Deliberately
left out: capacitance, transient behaviour, chip supply current, input
protection diodes, and supply sag. Tick-level logic timing stays as in
D-021.

## D-026 — Levels are read from voltages with 74HC thresholds (Accepted, Phase 4)

V ≥ 3.5 V reads 1, ≤ 1.5 V reads 0, between reads X. Strength stays
topological (strong, weak, none), and `none` is always Z, so floating
detection is unchanged. This is a visible semantic change from Stage 1:
an LED's anode sits one forward drop above its cathode (~2.1 V), so it now
reads X where Stage 1 said weak 1. The Phase 2 tests were updated to say
so. Dividers are no longer always X (10 k over 1 k reads 0). Equal
dividers still sit at 2.5 V and read X.

## D-027 — LED burn-out is permanent until the LED is replaced (Accepted, Phase 4)

Each LED has `maxMilliamps` (20, the continuous rating) and
`burnMilliamps` (40). Between the two it lights at full brightness with an
`OVERCURRENT` warning. Past `burnMilliamps` the engine marks it burnt and
it becomes an open circuit, with a persistent `LED_BURNT` warning ("current
limit exceeded", with the current that killed it). Adding the missing
resistor afterwards does not revive it. Removing the part does, because
the replacement is a new part with a new id. This is sim state, not user
state, so it is not saved (ARCHITECTURE §6) and a fresh board starts with
every LED healthy.

## D-028 — Contention means an output over 25 mA against an opposing driver (Accepted, Phase 4)

25 mA is the 74HC absolute maximum output current. Two opposing outputs
joined directly draw 50 mA through each other (2 × 50 Ω across 5 V) and
raise `CONTENTION`. The same pair through 330 Ω draws 11.6 mA, which is
within limits, so there is no warning. Outputs fighting a supply rail are
contention too. An output over the limit with no opposing driver on its
net (e.g. into 100 Ω to ground) is `OUTPUT_OVERLOAD` instead. An `X`
output never raises either, since its 2.5 V source is a stand-in, not a
real drive.

## D-029 — Resistor values are part types (Accepted, Phase 4)

`resistor` (330 Ω, unchanged for existing tests and saves),
`resistor-100`, `resistor-1k` and `resistor-10k`. Each is drawn with its
real colour code, computed from `props.ohms`, and labelled with its value.
An editable value belongs to the Phase 5 inspector. When it arrives it can
become part `state` without changing the solver, which already reads
`props.ohms` per part.

## D-030 — Vendored files: the three the brief named, hashed (Accepted, Phase 4.5)

`novalang.py`, `bootstrap.py` and `novalang.nova` are copied unmodified from
the NovaLang repo at commit `02eabdb` (v1.1.0). `public/nova/VERSION`
records the commit and each file's SHA-256, and a test checks them. `lib/`,
which D-003 also listed, is left out because nothing in Breadboard imports
it. Only `novalang.py` runs. The NovaLang `Nova` class is the embedding
API; the self-hosted interpreter is not needed.

## D-031 — Bridge contract v2 adds `board.resistor` (Accepted, Phase 4.5)

The Phase 4.5 brief said to implement the bridge exactly as written (10
commands). But the written contract had no resistor, and Phase 4's
electrical model burns out an LED driven without one: a 74HC output into
a bare LED is about 46 mA. A v1 script therefore could not build the
half adder the acceptance criteria asked for. The contract itself named
`board.resistor` as "the expected first edit", so it was added as command
11 with a version bump to v2. Values are 100, 330, 1 000 or 10 000 Ω.
Every v1 call is unchanged, and v1 requests are still accepted (minus
`board.resistor`). **Flagged to the project owner.** To stay at 10
commands, drop `board.resistor` and give `board.led` a built-in series
resistor instead. In the same spirit, `board.led` and `board.resistor`
accept `pin:` refs the way `board.wire` does (D-011), and leads aimed at
one strip get distinct holes. This is done in the bridge layer
(`src/worker/bridge.ts`), because Phase 4.5 leaves `domain/` untouched.
Known gap, left in domain/ for Phase 5: `board.wire` with both ends as
`pin:` refs in the same strip picks the same hole twice and is refused. `board.chip` takes `"7400"` or `"74HC00"`
(every chip is the 74HC part).

## D-032 — Scripts get no Python objects and no `python.*` (Accepted, Phase 4.5)

Tested under Pyodide, NovaLang's embedding bridge is not the narrow bridge
its README describes:

- `expose_global(name, obj)` resolves any attribute on a lookup,
  underscores and dunders included (only listing keys hides them), and can
  set any attribute.
- `python.get("json.__builtins__")` returns `builtins`, and allowlisted
  modules re-export others (`statistics.sys`). That leads to
  `sys.modules`, then Pyodide's `js`, then arbitrary JavaScript in the
  worker.

Breadboard therefore binds `board` and `sim` as **dicts of functions**.
NovaLang calls them but cannot index them or read their attributes, and
the dicts are copied in. It also deletes the `python` global from every
engine (imported modules never had it). This costs scripts nothing they
need: NovaLang has its own math, random and JSON built-ins. The NovaLang
files stay unmodified (the brief's rule), and these findings belong
upstream. `tests/acceptance/phase45-isolation.test.ts` pins every escape
attempt, so a NovaLang update that changes the picture shows up as a test
change.

## D-033 — Pyodide via npm, served same-origin by a Vite plugin (Accepted, Phase 4.5)

`pyodide` (314.0.7, Python 3.14) is a dev dependency. `vite.config.ts`
serves its five runtime files at `/pyodide/` in dev and emits them into
`dist/pyodide/` (about 13.5 MB, 3.6 MB of it gzipped wasm). The nova
worker loads it with a dynamic `import()` of `/pyodide/pyodide.mjs`, so
Vite never bundles it. Same-origin loading keeps the COEP `require-corp`
headers simple and the version pinned. Tests load the same package in
Node.

## D-034 — How the bridge is tested (Accepted, Phase 4.5)

Vitest runs the real vendored NovaLang under the real Pyodide in Node, with
the real `host.py`, bridge dispatcher and `SimService`. The only
difference from the browser is the transport: a direct function call
instead of the two-worker `SharedArrayBuffer` hop. The response-buffer
helpers are unit-tested, and the full hop (plus `fetch` stripping, hard
kill, Stop, and loading nothing from off-site) is verified in Chromium.
The watchdog's soft stop is tested in Node by a worker thread that writes
SIGINT into the interrupt buffer while NovaLang spins on the main thread.
