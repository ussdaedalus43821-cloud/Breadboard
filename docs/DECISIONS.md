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
`board.resistor`). Flagged to the project owner. To stay at 10
commands, drop `board.resistor` and give `board.led` a built-in series
resistor instead. In the same spirit, `board.led` and `board.resistor`
accept `pin:` refs the way `board.wire` does (D-011), and leads aimed at
one strip get distinct holes. This is done in the bridge layer
(`src/worker/bridge.ts`), because Phase 4.5 leaves `domain/` untouched.
Known gap, left in domain/ for Phase 5: `board.wire` with both ends as
`pin:` refs in the same strip picks the same hole twice and is refused.
**Fixed in Phase 5 (D-035).** **v2 approved by the project owner.** `board.chip` takes `"7400"` or `"74HC00"`
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

## D-035 — Lead normalization moves back into domain/; the same-strip wire gap is fixed (Accepted, Phase 5)

The dispatcher resolves every `pin:` lead (wire ends, `placeLeads` pins)
through one helper. That helper picks the nearest free hole joined to the
pin and skips holes already claimed by earlier leads of the same command.
So `board.wire("pin:D1:anode", "pin:R1:1")` with both pins in row 10 lands
in b10 and d10 instead of being refused. The bridge's Phase 4.5 copy of
this logic is deleted, leaving one path.

## D-036 — History lives in the sim worker; switch flips are not edits (Accepted, Phase 5)

Undo must restore the circuit the sim, the UI and scripts all see, so it
belongs where that circuit lives. Entries are snapshots of immutable
circuits: cheap, and they make undo exact. Switch flips are excluded.
Truth-table testing flips switches dozens of times, and those flips would
bury the edits you actually want back. Script runs and the demo loader
are grouped into one entry. Clear board is now undoable (`reset`). The old
`hello` request still starts a session and clears history, and the
bridge's `board.new` uses `reset`, so `sim.time()` restarts at 0 as the
contract says.

## D-037 — Resistor values change in place (Accepted, Phase 5)

The inspector's value picker sends `setResistance { id, ohms }`. That
swaps the part's registry type (`resistor`, `resistor-100`, …) and keeps
its id and holes, so it is undoable and saves as the new type. Only the
stocked values (100 Ω, 330 Ω, 1 kΩ, 10 kΩ) are accepted. This is a
dispatcher command only: the bridge contract is unchanged (v2). A script
picks a value with `board.resistor` and cannot yet change it afterwards.

## D-038 — Zoom/pan deferred (Accepted, Phase 5)

The original Phase 5 line listed zoom/pan. The Phase 5 brief did not, and
at half size the board fits a laptop screen at the fixed 20 px pitch. It is
a pure UI change (`createBoardLayout` already takes the pitch).

## D-039 — Chip logic is a list of stateful blocks (Accepted, Phase 6)

`ChipLogic.gates` became `ChipLogic.blocks`. A block is a pure
`eval(inputLevels, state) → { outputs, state }`, and gates are the
stateless case. The engine keeps each block's state (`<part>#<index>`),
evaluates every block after every solve, and applies outputs after
`delayTicks` with the same inertial rule as before. Because evaluation
repeats on every solve, `eval` must be idempotent for unchanged inputs: an
edge is a change between evaluations and is seen once. `dipChip` builds any
DIP from a pin table, and `gateChip` is now a thin wrapper over it. This
keeps chips as data (D-024) while allowing memory.

## D-040 — 74HC74 power-up and unknown PRE'/CLR' (Accepted, Phase 6)

Real 74HC74s power up in an arbitrary state. Breadboard's power up
**cleared** (Q = 0), so counters start at 0 without a power-on-reset
circuit. A floating or unknown PRE'/CLR' **holds** the stored state and
ignores the clock (it does not become X). Real parts are unpredictable
there, and the floating-input warning still flags a floating one. This
matters at power-up. The sim's outputs start undriven for one tick, so a
reset loop (NAND of two Qs into CLR', as in the decade counter) would
otherwise see X, push every flip-flop to X, and never recover. Real chips
settle in nanoseconds and never show that deadlock. With PRE' and CLR'
both low, both outputs are high and Q is undefined once they are released.

## D-041 — A function-generator clock lead, so the analyzer has a square wave to show (Accepted, Phase 6)

At 1 kHz, the analyzer's 50 ticks are 50 ms. A switch flipped by hand is
flat across that window, so "a square wave on a clock wire" needs a
periodic source. The clock lead is a third supply kind, like the +5 V and
ground leads: plugged into a hole, 0/5 V behind 50 Ω (a function
generator's usual output impedance), with a period of 2 to 10 000 ticks
(the UI offers 500, 100, 50, 10 and 1 Hz). `clock` places one, `setPeriod`
changes it (undoable), and saves carry `periodTicks`. The engine re-solves
at each of its edges. A 1 Hz clock lead also runs the decade counter by
itself.

## D-042 — The analyzer samples in the sim worker; frames are capped at ~60/s while running (Accepted, Phase 6)

Only the sim worker sees every tick: frames are batched per wake-up. So it
samples up to 4 probed terminals per tick into a 50-tick ring and sends the
ring in every frame (`trace`). Edits re-sample the current tick. A fast
clock lead changes something on every 4 ms wake-up, which used to mean a
frame every 4 ms. While the real-time clock runs, frames are now sent at
most every 16 ms. Probes keep the analyzer scrolling even when nothing
else changes. Step and edits still publish at once. The panel puts each
channel's samples in a `data-samples` attribute and its aria-label, for
tests and screen readers.

## D-043 — The decade counter needs a decoder and a reset (Accepted, Phase 6)

The brief asked for a 4-bit counter of 74HC74s on a 7-segment display,
counting 0–9. Done the real way, that takes two more things:

- **A 74HC4511 BCD-to-7-segment decoder**, since the counter is binary and
  the display needs seven segment lines. It was added as a chip.
- **A NAND(Q1, Q3) into every CLR'** (one 74HC00 gate), which resets at
  10, since a 4-bit counter would otherwise run on to 15.

The demo is a ripple counter: each stage's Q' feeds its own D (toggle) and
clocks the next stage, so it counts up. It also has seven 330 Ω segment
resistors (7.6 mA each) and needs the full-size board (more than 30 rows of
chips). The 7-segment display has the real 10-pin pinout: the brief's 7
segment inputs and a common, plus the decimal point and a second, joined
common pin.

## D-044 — Flexible-lead parts are clicked along their leads (Accepted, Phase 6)

`partAtPoint` used each part's bounding box. The decade counter's
diagonal segment resistors cover the display's box, so clicking the
display selected a resistor. LEDs and resistors are now hit within half a
pitch of the line between their leads. Chips, switches and displays keep
the box. Wires are hit the same way, which is how they are probed.

## D-045 — Bridge contract v3: board.display and board.clock (Accepted, Phase 7)

Approved by the user. Scripts could not place a 7-segment display or a
clock lead, so the Phase 6 circuits could only be built from the UI. v3
adds `board.display(at)` (a part handle plus a `segments` map of pin keys)
and `board.clock(at, hz=100)`. `hz` is given in hertz, the unit people
think in, and must map to an even whole number of 1 ms ticks: the sim's
clock toggles on whole ticks, and a rate that does not fit is refused
rather than rounded.

Backward compatibility is per op: `OP_SINCE` in `protocol/bridge.ts` says
which version introduced each newer op, and a request with a lower `v` is
refused with `<op> needs bridge contract v<n>`. Every v1 and v2 call works
unchanged. `board.chip` also accepts the bare `74xx` names of the Phase 6
chips (`"7432"`, `"7486"`, `"7474"`).

## D-046 — Zoom and pan are a view transform in the renderer (Accepted, Phase 7)

Supersedes D-038. The board is drawn through a `View` (zoom and offset,
`ui/canvas/viewport.ts`) instead of resizing the layout: the canvas is the
size of a fixed viewport box, and the renderer sets one canvas transform
per frame. `hitTest` and `localPoint` undo the view, so the editor keeps
working in board pixels and pitch points and needed no change for zoom.

- Wheel zooms around the cursor (the board point under it stays put),
  0.25× to 4×. Middle-drag or Space+drag pans. The **−** / **+** / **Fit**
  buttons and the `-`, `+` and `0` keys do the same from the keyboard.
- The view is clamped so at least 60 px of board stays on screen.
- A fitted view (never past 100%) refits on window resize and when a load
  changes the board size. Once the user zooms or pans, resizes keep their
  view.
- Space is the pan modifier only while the pointer is over the board, and
  then it blurs a focused button rather than pressing it.
- The inspector is now a fixed column with an empty state. Before, it
  appeared on selection and shrank the board box, which cut off a zoomed
  view mid-click.

## D-047 — Hosting sends COOP/COEP from the host's config (Accepted, Phase 7)

The NovaLang bridge needs `SharedArrayBuffer` and `Atomics.wait` (D-026),
which browsers only enable on a cross-origin-isolated page. The dev and
preview servers already send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (vite.config.ts). For
production, `netlify.toml` and `vercel.json` send both headers on every
path. All assets, Pyodide included, are same-origin, so `require-corp`
blocks nothing. A test parses both files and checks the headers. Netlify
also caches `/pyodide/*` as immutable: those files are named by the
Pyodide version they come from.

## D-048 — A "Start here" dialog on first load (Accepted, Phase 7)

A native `<dialog>`, which brings focus handling, Escape and a backdrop
for free. It offers the clocked counter, the half adder, or an empty bench,
and is remembered in localStorage once closed (any way). Access is
guarded: with storage blocked it shows on every visit, which is harmless.
It does not open over a shared link, since that visitor came for a
particular circuit. The toolbar's **?** button opens it again.

The clocked counter demo is the manual decade counter with SW1, its
pull-down and its +5 V wire replaced by a 1 Hz CLK lead at `a47`, so it
counts without any clicks.
