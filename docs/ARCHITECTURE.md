# Breadboard — Architecture

This is the stable reference for how Breadboard is put together. Read it first
when coming back after a long gap. If the code and this document disagree,
one of them is a bug: fix the code, or edit this file on purpose in the same
commit.

Companion contracts:

- [`NOVALANG_BRIDGE.md`](NOVALANG_BRIDGE.md) — the exact API NovaLang scripts get.
- [`NOVALANG_ISOLATION.md`](NOVALANG_ISOLATION.md) — what a NovaLang script cannot do.

## 1. What Breadboard is

A web sandbox where users build digital logic circuits on a virtual
solderless breadboard using real-world parts: 74xx chips, LEDs, resistors,
switches, jumper wires, power rails. The simulation is written in
TypeScript and runs in a Web Worker. **NovaLang** (a separate,
hand-written scripting language, treated as a third-party library) is the
_scripting layer_. It authors, tests and drives circuits. It is **not** the
simulation engine.

Stack (decided): Vite + TypeScript + Vitest, Canvas 2D rendering, the sim in
a Web Worker, NovaLang in a second Web Worker under Pyodide that is loaded
lazily the first time the scripting panel opens.

## 2. Layers

```
src/
  domain/          pure TypeScript: geometry, netlist, parts, circuit, sim
    breadboard/      spec.ts (board geometry), terminal.ts (TerminalRef),
                     netlist.ts (union-find, resolveNet)
    parts/           types.ts (PartDef, PlacedPart, PinFootprint), registry.ts,
                     footprint.ts (where a part's pins land)
    circuit/         circuit.ts (Circuit, supplies, occupancy, circuitNetlist,
                     benchCircuit), commands.ts (the edit dispatcher: place,
                     placeLeads, wire, power, ground, set, setResistance,
                     remove), save.ts (save format, §6), history.ts (undo/redo)
    sim/             solver.ts: Stage-2 electrical solver (§4a); electrical.ts
                     (constants); mna.ts (linear solve); engine.ts: ticks,
                     propagation delay, LED burn-out (§4b)
    chips/           gate.ts (gate functions, ChipLogic, dipFootprint, the
                     gateChip builder), catalog.ts (74HC00/02/04/08)
    demos/           demo circuits as command lists (half-adder.ts)
  protocol/        JSON message types between main thread and workers:
                     sim-protocol.ts (requests, responses, circuit/frame pushes),
                     circuit-host.ts (the UI's one door into the Circuit),
                     bridge.ts (the NovaLang bridge wire format and caps),
                     sync-buffer.ts (the shared response slot),
                     nova-protocol.ts (main thread ↔ nova worker)
  worker/          sim-service.ts (owns the Circuit, answers requests, solves),
                     bridge.ts (the bridge dispatcher: ops → SimService),
                     bridge-server.ts (answers the nova worker through the
                     shared slot), sim.worker.ts (entry point)
  nova/            the nova worker: worker.ts (Pyodide, global stripping,
                     the blocking transport), runtime.ts (loads NovaLang +
                     host.py into a Pyodide; shared with the tests),
                     host.py (the board/sim globals and the script runner)
  ui/              everything that touches the DOM or a canvas
    canvas/          board-renderer.ts, board-layout.ts, part-shapes.ts
    editor/          editor.ts: palette tool, click-to-place, drag-to-wire,
                     select (inspector), click-to-toggle switches (no DOM)
    persistence/     storage.ts (named saves in localStorage), share.ts
                     (the #circuit=… URL codec)
    worker-circuit-host.ts  CircuitHost over the sim-worker protocol
    nova-client.ts   lazy nova worker start, bridge hookup, the watchdog
    panels/          scripting-panel.ts, inspector.ts; the palette and toolbars
                     are plain HTML in index.html
  main.ts          entry point: wires the UI to the workers
```

Dependency direction (an arrow means "may import"):

```
ui ──► protocol ──► domain
 │                    ▲
 └────────────────────┘        worker ──► protocol, domain
                               nova   ──► protocol
```

Rules:

1. **`src/domain/` imports only from `src/domain/`.** It never imports
   `ui/`, `worker/`, `protocol/` or any DOM API. ESLint enforces this with
   `import/no-restricted-paths`. `no-restricted-globals` bans `window`,
   `document`, `localStorage` and similar inside `domain/`. A Vitest test
   (`tests/acceptance/phase0.test.ts`) lints a deliberately bad import and
   checks that the rule fires, so the guard cannot quietly stop working.
   The same rule keeps `ui/` from importing `worker/` and `protocol/` from
   importing either (`tests/acceptance/phase2.test.ts`).
2. `domain/` is deterministic and synchronous: no timers, no `Math.random`
   without an injected seed, no I/O. That keeps it testable in plain Node
   and lets the same code run in the worker and in tests.
3. `ui/` may import `domain/` for **pure geometry and types** (for example
   `spec.ts` to know where holes are drawn). It must not run the simulation
   on the main thread. Sim state reaches the UI only as frames from the sim
   worker.
4. `protocol/` holds only JSON-serializable types and validators. Every
   message that crosses a worker boundary is described there.

## 3. Threads and the worker boundary

```
┌────────────── main thread ──────────────┐
│ ui/ (canvas, palette, scripting panel)  │
│   ▲ frames (sim → ui)   │ edits (ui → sim)
└───┼─────────────────────┼───────────────┘
    │                     ▼
┌───┴──────── sim worker ───────────────┐      ┌──────── nova worker (lazy) ────────┐
│ domain/: circuit, netlist, sim        │◄────►│ Pyodide + NovaLang (vendored)      │
│ owns the ONE authoritative Circuit    │ JSON │ board / sim proxies (Python)       │
│ command dispatcher (bridge commands)  │bridge│ runs user scripts, watchdog-killed │
└───────────────────────────────────────┘      └────────────────────────────────────┘
```

- **The sim worker owns the authoritative circuit.** UI edits (place, wire,
  delete) and NovaLang commands both go through the same command
  dispatcher in the sim worker. They are two clients of one API, and
  neither one mutates state directly.
- **The UI never computes sim state.** The sim worker posts _frames_:
  changed net levels, LED states and warnings. The renderer draws whatever
  the latest frame says.
- **The NovaLang worker talks only to the sim worker**, over a
  `MessageChannel` port the main thread hands to both workers at
  start-up. The traffic is the JSON command/query bridge in
  `NOVALANG_BRIDGE.md`: 11 commands and 3 queries. NovaLang never sees the
  solver, the tick loop, the netlist object or the renderer. It sees
  JSON. `src/nova/` may import only `protocol/` (ESLint), and the sim side
  turns each bridge op into the same `SimService` requests the UI sends,
  so there is one validation path. Pushes caused by a script go to the
  UI, so the board visibly builds while a script runs.
- **Synchronous calls from NovaLang.** NovaLang code is synchronous
  (`board.run(100)` then `sim.get("hole:e15")` must see the result). The
  nova worker posts the request on the port and then blocks in
  `Atomics.wait` on a `SharedArrayBuffer` response slot. The sim worker
  writes the JSON response there and calls `Atomics.notify`. This requires
  cross-origin isolation (COOP `same-origin` + COEP `require-corp`).
  `vite.config.ts` sets both headers for `dev` and `preview`, and any
  production host must send them too. Without isolation, the scripting
  panel is disabled with an explanation, and the rest of the game still
  works.
- **Lazy load.** Pyodide and the vendored NovaLang files are fetched the
  first time the scripting panel opens, never at start-up. Pyodide comes
  from the `pyodide` npm package: a small Vite plugin serves it at
  `/pyodide/` in dev and copies it into the build, so it is same-origin,
  versioned by `package-lock.json`, and never loaded from a CDN.
- **Isolation** of scripts is its own document:
  [`NOVALANG_ISOLATION.md`](NOVALANG_ISOLATION.md).

## 4. TerminalRef discipline

`TerminalRef` is **the one and only way to name an electrical connection
point.** Every breadboard hole, rail hole, part pin and wire end is a
TerminalRef. There is no second naming scheme anywhere: not in the UI, not
in saves, not in NovaLang.

```ts
type HoleRef = { kind: 'hole'; column: 'a'|'b'|…|'j'; row: number }   // row 1-based
type RailRef = { kind: 'rail'; rail: 'top+'|'top-'|'bottom+'|'bottom-'; index: number } // 1-based
type PinRef  = { kind: 'pin';  part: string; pin: string }             // pin name from the part def
type TerminalRef = HoleRef | RailRef | PinRef
```

Each one has exactly one **canonical string key**, and `terminalKey` and
`parseTerminal` round-trip exactly:

| Ref                                   | Key           |
| ------------------------------------- | ------------- |
| `{kind:'hole', column:'e', row:15}`   | `hole:e15`    |
| `{kind:'rail', rail:'top+', index:3}` | `rail:top+:3` |
| `{kind:'pin', part:'U1', pin:'14'}`   | `pin:U1:14`   |

- Keys are what crosses JSON boundaries (saves, protocol, NovaLang).
  Objects are what domain code passes around. Convert only with
  `terminalKey` / `parseTerminal` and never build keys by string
  concatenation elsewhere.
- Part ids match `^[A-Za-z][A-Za-z0-9_]*$`. Pin names match
  `^[A-Za-z0-9_]+$`. That way `:` can never be ambiguous.
- **Holes and rail holes** exist because the board spec says so.
  **Pins** exist because a part is placed. Placing a part _connects_ each
  pin to the hole it sits in, and that connection is an ordinary netlist
  union.
- **Wire ends are holes or rail holes.** A wire is a pair of board
  TerminalRefs, and **each hole holds at most one lead** (a part pin or a
  wire end). Where a caller names a pin as a wire end (the editor does when
  a drag starts on a pin, NovaLang may do it for convenience), the
  dispatcher stores the wire in the **nearest free hole the board joins to
  that pin's hole** (same row strip or rail line). The pin's own hole is
  taken by the pin, and electrically the result is identical (D-011).

### Netlist

`domain/breadboard/netlist.ts` builds an immutable `Netlist` with a
union-find over terminal keys:

1. Seed every terminal in the board spec. Union each terminal strip (holes
   `a–e` of one row, holes `f–j` of one row) and each rail line, or each
   rail half when `splitRails` is set.
2. Register part pins and union each pin with its hole.
3. Union the two ends of each wire.

`circuitNetlist(circuit)` does all three. A closed switch is **not** in the
static netlist: whether a switch conducts is sim state, joined by the
solver (§4a).

`resolveNet(ref)` returns every terminal electrically joined to `ref`,
sorted by key. Its result round-trips: for every `t` in `resolveNet(r)`,
`resolveNet(t)` returns the same set. A net's id is `net:` plus the
smallest key in it, so ids are deterministic and change only when nets
merge or split.

## 4a. The electrical solver (Stage 2)

`domain/sim/solver.ts` turns a Circuit, plus what each chip output is
driving, into a `SimResult` for one instant. That result holds every net's
**voltage**, logic level and drive strength, each part's observable state
(LED current, brightness and burn-out; resistor current; switch position),
and warnings. Time and gate delay live in the engine around it (§4b).
Stage 1 (Phase 2) propagated logic levels only. Stage 2 (Phase 4) computes
voltages and currents, and reads levels from them (D-025).

1. **Topology.** Start from the static netlist and join nets through
   closed switch contacts (SPST position 1; SPDT `com`–`a` at 0, `com`–`b`
   at 1). Switches and wires are ideal conductors.
2. **Elements** (constants in `domain/sim/electrical.ts`):
   - **Drivers** are voltage sources behind a series resistance. A
     bench-supply lead is 5 V or 0 V behind 0.1 Ω. A 74HC output is 5 V
     (1), 0 V (0) or 2.5 V (`X`, a gate with a floating input) behind
     50 Ω. An unpowered chip's outputs drive nothing.
   - **Resistors** are conductances, valued from `props.ohms` (100 Ω,
     330 Ω, 1 kΩ, 10 kΩ in the registry).
   - **LEDs** are piecewise-linear diodes: off (1 nS leakage), or on as
     `forwardVolts` (2.0 V) plus `seriesOhms` (15 Ω). A burnt LED is open.
   - Chip inputs and supply pins draw no current.
3. **Nodal analysis** (`domain/sim/mna.ts`) over the nets that touch an
   element, with a 1 pS `gmin` to 0 V on every node so the matrix is never
   singular. LED on/off states are iterated until they agree with the
   voltages (at most 50 rounds; a few in practice).
4. **Strength** is topological: `strong` if a driver is on the net, `weak`
   if a resistor path reaches one, `none` otherwise. **Level** comes from
   the voltage with 74HC thresholds at 5 V: ≥ 3.5 V reads 1, ≤ 1.5 V reads
   0, between reads `X`. A `none` net is `Z` (its `volts` is `null`),
   whatever leakage says. A net an `X` output drives is `X` (D-026).

| Level     | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `1` / `0` | Driven, at or beyond V_IH / V_IL                                                          |
| `Z`       | Floating: no driver, no resistor path to one                                              |
| `X`       | Between thresholds (a fight, a divider, an LED anode at ~2 V), or driven by an `X` output |

5. **Warnings.** Each names the TerminalRef keys involved, and the renderer
   rings those pins in yellow.

| Code              | When                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FLOATING_INPUT`  | A chip `input` pin is on a `Z` net                                                                                             |
| `CHIP_UNPOWERED`  | A chip `power` pin is not at 1, or a `ground` pin is not at 0                                                                  |
| `SHORT`           | A bench-supply lead exceeds the 1 A current limit                                                                              |
| `CONTENTION`      | A 74HC output exceeds its 25 mA absolute maximum while another driver on the same net drives the opposite level (D-028)        |
| `OUTPUT_OVERLOAD` | A 74HC output exceeds 25 mA with no opposing driver on its net (e.g. into 100 Ω to ground)                                     |
| `OVERCURRENT`     | An LED carries more than its rated `maxMilliamps` (20 mA) but is still alive                                                   |
| `LED_BURNT`       | An LED was driven past `burnMilliamps` (40 mA): "current limit exceeded". It stays an open circuit until it is removed (D-027) |

Pin roles (`input`, `output`, `power`, `ground`, `passive`) are data on
each `PinFootprint`, so chips declare what must not float (D-020).

## 4b. Chips and time

**Chips are data.** `domain/chips/gate.ts` has the gate functions (`AND`,
`OR`, `NAND`, `NOR`, `XOR`, `NOT`) and one builder, `gateChip`, that turns
a 14-pin pinout table and a gate function into a `PartDef`. The builder
supplies the footprint, pin roles, datasheet pin names (`1A`, `1Y`, …) and
`logic: ChipLogic` (gates, VCC/GND pins, `delayTicks`).
`domain/chips/catalog.ts` lists the 74HC00 (NAND), 74HC02 (NOR), 74HC04
(NOT) and 74HC08 (AND). Adding a chip is one `gateChip(...)` call. Gate
functions handle unknowns: a controlling input decides (`NAND(0, Z) = 1`);
otherwise a floating or `X` input gives `X`.

**Time is ticks.** `domain/sim/engine.ts` wraps the solver in a fixed-step
`Simulation`: **1 tick = 1 ms (1 kHz)**. Each chip output has a current
level and at most one pending change. Stepping from tick t to t+1:

1. Apply output changes scheduled for t+1.
2. Re-solve with the new outputs (only if something changed).
3. Evaluate every gate on the solved levels. If a gate's value differs from
   its output, schedule the change at t+1+`delayTicks`. If it matches,
   cancel any pending change (**inertial delay**: a pulse shorter than the
   delay never reaches the output).

An edit (`load`) re-solves and schedules **without advancing time**, so an
input change shows at once but its effect on any output waits at least one
tick. A signal through n gates takes n ticks. Every 74HC chip has
`delayTicks = 1`: the real ~8 ns is far below one tick, and one tick is the
smallest delay the 1 kHz sim can show (D-021).

**Who moves time.** `SimService` never reads a clock itself:

- `step` / `run` requests (the bridge's `board.step` / `board.run`) advance
  an exact number of ticks, with the bridge's caps (100 000 ticks, 10 000
  ms; `run` rounds ms up to whole ticks).
- `serveSim(port, service, clock)` installs a real-time loop: every ~4 ms
  of wall time it runs the ticks owed (one per elapsed ms, at most 250 at a
  time, so a backgrounded tab does not replay minutes). A `clock` request
  starts or pauses it. The worker passes the real clock; tests pass none
  (or a fake), so they stay deterministic (D-023).

**Burn-out is engine state.** After every solve the engine checks each
LED against `burnMilliamps`. Any LED over it is recorded as burnt (with
the current that killed it) and the circuit is solved again with that LED
open, until nothing more burns. Burning is instant: it does not wait for a
tick. The record is dropped only when the LED's part is removed, so fixing
the circuit afterwards does not revive it, just as on a real bench.

**What the UI sees.** After every edit or step the worker pushes `circuit`
(if it changed), then a `frame` (the `SimResult` plus `revision`, `time`,
`settled`, `running`), then the response. A caller awaiting `apply` or
`step` has therefore already seen the new circuit and frame. While the
real-time clock runs, a frame goes out only when an output changes. When
nothing changes, a small `time` message goes out about 10 times a second.

## 5. Board geometry

`domain/breadboard/spec.ts` describes the board in **pitch units**
(1 unit = 0.1" = 2.54 mm). The renderer turns pitch coordinates into
pixels, so domain code never knows about pixels.

| Size             | Rows | Terminal holes | Rail holes   | Tie points |
| ---------------- | ---- | -------------- | ------------ | ---------- |
| `half` (default) | 30   | 300            | 4 × 25 = 100 | 400        |
| `full`           | 63   | 630            | 4 × 50 = 200 | 830        |

- Columns `a–e` and `f–j` with a 0.3" centre channel between `e` and `f`
  (exactly the width of a DIP package, so a 74xx chip straddles it).
  Drawn as on most real boards: `j` at the top, `a` nearest the viewer. A
  DIP with pin 1 in `e` then reads like the real part: notch left, pin 1
  bottom-left, pins numbered counterclockwise seen from above (D-009).
- Four rails: `top+`, `top-`, `bottom+`, `bottom-`. Rail holes come in
  groups of 5 with one empty pitch between groups, centred along the board.
- `splitRails` (config flag, default `false`) splits each rail line into
  two independent halves, as on many full-size boards.
- The size is a config flag: `boardSpec('half')` or `boardSpec('full')`.
  Nothing else in the code assumes 30 rows.

## 6. Save format (`domain/circuit/save.ts`)

Saves are JSON, versioned and **declarative**. They record what the user
built. Derived data (the netlist) and transient sim state (net levels,
time) are never saved. The only state saved is user-set part state such as
switch positions.

```json
{
  "format": "breadboard",
  "version": 1,
  "board": { "size": "half", "splitRails": false },
  "parts": [
    { "id": "U1", "type": "chip7400", "at": "hole:e10" },
    { "id": "SW1", "type": "switch-spdt", "at": "hole:a3", "state": { "position": 0 } },
    { "id": "D1", "type": "led-red", "pins": { "anode": "hole:b20", "cathode": "hole:b21" } }
  ],
  "wires": [{ "id": "W1", "from": "hole:a4", "to": "hole:a10", "color": "yellow" }],
  "supplies": [
    { "id": "VCC", "kind": "power", "at": "rail:top+:1", "volts": 5 },
    { "id": "GND", "kind": "ground", "at": "rail:top-:1" }
  ],
  "meta": { "title": "Half adder", "created": "2026-10-24T00:00:00Z" }
}
```

Rules:

- Every connection point in a save is a TerminalRef **key**. Fixed
  footprints use `at` (the hole of pin 1). Parts with flexible leads (LEDs,
  resistors) list `pins` explicitly.
- `version` bumps on any incompatible change. The loader carries a chain
  of `migrate_vN_to_vN+1` functions in `domain/`, and old saves are never
  rejected silently.
- Loading a save (`fromSave`) means replaying it through the same command
  dispatcher the UI and NovaLang use, so there is one validation path, and
  a damaged or hand-edited save is refused with the dispatcher's own
  message ("part D2: hole:a1 already holds pin:D1:anode"). **Ids are
  kept**: before each placement the id counter is steered to the saved id,
  so scripts that name `SW1` or `D2` work on a loaded circuit. Afterwards,
  ids continue past the highest saved number and are never reused.
- `toSave` writes `meta.title` and `meta.created`. Everything else in a save
  is the circuit.
- **Where saves go** (main thread, `ui/persistence/`): named slots in
  `localStorage` under `breadboard:circuit:<name>`, with every access
  guarded, since storage can be missing or throw. **Shareable URLs** carry
  the same JSON, deflate-raw compressed (`CompressionStream`) and
  base64url-encoded, in the fragment: `#circuit=1.<data>`, where `1.` is
  the encoding version. The fragment never reaches a server. The half
  adder is about 720 characters. Opening such a link loads the circuit
  once the sim worker is up.
- Loading, from storage or a link, goes to the sim worker as a `load`
  request and is one undoable edit (§6a).

## 6a. Undo and redo

The sim worker owns history (`domain/circuit/history.ts`), because it owns
the circuit. Circuits are immutable values, so an entry is the circuit as it
was before an edit, plus a label for the UI ("place D1", "remove R2",
"change R3", "clear board", "load circuit", "script run").

- **Recorded:** every dispatcher edit except switch flips, plus Clear board
  (`reset`) and loads. A switch flip is operating the circuit, as pressing
  a real switch is not editing the board, so it never clutters the history
  (D-036).
- **Groups:** `group open` … `group close` makes everything in between one
  entry. Script runs and the demo loader use it, so one Ctrl+Z undoes a
  whole `half_adder.nova`. Undo and redo are refused while a group is open.
- Undo/redo replace the circuit and keep sim time. Chip outputs and burnt
  LEDs carry over for parts that still exist, as after any edit. The
  history holds at most 200 entries and starts empty with each session
  (`hello`).
- Every frame carries `history: { canUndo, canRedo, undoLabel, redoLabel }`
  for the buttons. Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z, work everywhere
  except in text fields, which keep their own undo.

## 7. Phases

One phase per session. Each ends with green tests, a demo script in
`docs/demos/`, and acceptance encoded as Vitest integration tests under
`tests/acceptance/`.

| Phase | Scope                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Skeleton, board spec, netlist, empty board render with hole hit-testing                                         |
| 1     | Parts registry, click-to-place, drag-to-wire, palette                                                           |
| 2     | Stage-1 logic sim in the sim worker (0/1/Z, floating-input warning). Switch → wire → LED lights. First playable |
| 3     | 74xx chips as data (7400, then 7402/7404/7408 from one `gate.ts` builder). Half-adder demo                      |
| 4     | Stage-2 electrical: resistor-limited LED current, drive-strength contention warnings                            |
| 4.5   | NovaLang integration per `NOVALANG_BRIDGE.md`. Additive only; `domain/` is not touched                          |
| 5     | Save/load, undo/redo, inspector (resistor values), shareable URLs. Zoom/pan deferred (D-038)                    |

## 8. NovaLang as a dependency

- Source: the NovaLang repo, v1.1.0. It is treated as a third-party
  library and **not modified**.
- Vendored (Phase 4.5) into `public/nova/`: `novalang.py`, `bootstrap.py`
  and `novalang.nova`, plus `public/nova/VERSION` recording the source repo,
  commit and each file's SHA-256. A test checks the hashes, so the copies
  cannot drift unnoticed. Only `novalang.py` is loaded at run time. The
  others are kept for parity with upstream. `lib/` (ECS, spatial hash) is
  not vendored: nothing here uses it (D-030).
- Updating NovaLang means re-copying the files and updating `VERSION` in
  one commit, then running the isolation tests. They pin the behaviours
  Breadboard depends on and the ones it works around (D-032).
- Breadboard's own Python glue (`src/nova/host.py`) is never mixed into
  the vendored files.
- Example scripts live in `public/nova/examples/`.
