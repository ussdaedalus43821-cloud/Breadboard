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
                     placeLeads, wire, power, ground, set, remove)
    sim/             solver.ts: Stage-1 logic solver (§4a); engine.ts: ticks
                     and propagation delay (§4b); Stage-2 electrical (Phase 4)
    chips/           gate.ts (gate functions, ChipLogic, dipFootprint, the
                     gateChip builder), catalog.ts (74HC00/02/04/08)
    demos/           demo circuits as command lists (half-adder.ts)
  protocol/        JSON message types between main thread and workers:
                     sim-protocol.ts (requests, responses, circuit/frame pushes),
                     circuit-host.ts (the UI's one door into the Circuit)
  worker/          sim-service.ts (owns the Circuit, answers requests, solves),
                     sim.worker.ts (entry point: serves SimService on the worker
                     global); nova.worker.ts (Phase 4.5)
  ui/              everything that touches the DOM or a canvas
    canvas/          board-renderer.ts, board-layout.ts, part-shapes.ts
    editor/          editor.ts: palette tool, click-to-place, drag-to-wire,
                     click-to-toggle switches (no DOM)
    worker-circuit-host.ts  CircuitHost over the sim-worker protocol
    panels/          inspector, scripting panel (later phases); the Phase 1
                     palette is plain HTML in index.html
  main.ts          entry point: wires the UI to the workers
```

Dependency direction (an arrow means "may import"):

```
ui ──► protocol ──► domain
 │                    ▲
 └────────────────────┘        worker ──► protocol, domain
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
  `NOVALANG_BRIDGE.md`: 10 commands and 3 queries. NovaLang never sees the
  solver, the tick loop, the netlist object or the renderer. It sees
  JSON.
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
  first time the scripting panel opens, never at start-up.

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

## 4a. Stage-1 logic solver

`domain/sim/solver.ts` turns a Circuit into a `SimResult`: every net's
level and drive strength, each part's observable state, and warnings. It is
static: given what each chip output is driving right now, it solves one
instant. Time and gate delay live in the engine around it (§4b).

| Level     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `1` / `0` | Driven high / low                                                  |
| `Z`       | Floating: nothing drives the net                                   |
| `X`       | Conflict: strong 1 and 0 on one net (short), or a resistor divider |

1. Start from the static netlist and join nets through **closed switch
   contacts** (SPST position 1; SPDT `com`–`a` at 0, `com`–`b` at 1).
2. **Strong drivers** are supply leads (+5 V → 1, ground → 0) and chip
   outputs (whatever level the engine says each output is driving; an
   unpowered chip's outputs drive nothing). Strong 1 against strong 0 on
   one net gives `X` plus a `SHORT` warning naming every driver. A strong
   `X` (a gate with a floating input) makes the net `X` with no warning.
3. **Resistors pass a weak copy** of a strong level to undriven nets.
   Undriven nets joined by resistors form a group, and the group takes the
   strong levels it touches through resistors: one level gives that level
   (weak), both give `X`, none gives `Z`. Real voltages come with Stage 2
   (Phase 4) (D-017).
4. **LEDs are loads** and never drive either net. An LED is lit when its
   anode is 1 and its cathode is 0, at any strength.
5. **Warnings:** `FLOATING_INPUT` for a chip `input` pin on a `Z` net;
   `CHIP_UNPOWERED` for a `power` pin not at 1 or a `ground` pin not at 0;
   `SHORT`. Each names the TerminalRef keys involved, and the renderer rings
   those pins in yellow.

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

## 6. Save format (implemented in Phase 5, defined now)

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
- Loading a save means replaying it through the same command dispatcher
  the UI and NovaLang use, so there is one validation path. Shareable URLs
  (Phase 5) are the same JSON, compressed and base64url-encoded in the
  fragment.

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
| 5     | Save/load, undo/redo, inspector, zoom/pan, shareable URLs                                                       |

## 8. NovaLang as a dependency

- Source: the NovaLang repo, v1.1.0. It is treated as a third-party
  library and **not modified**.
- Vendored (Phase 4.5) into `public/nova/`: `novalang.py`, `bootstrap.py`,
  `novalang.nova`, `lib/`, plus `public/nova/VERSION` recording the source
  repo and commit. Updating NovaLang means re-copying the files and bumping
  `VERSION` in one commit.
- Breadboard's own Python glue (the board/sim proxies and the host
  runner) lives in Breadboard under `src/nova/` and is never mixed into
  the vendored files.
