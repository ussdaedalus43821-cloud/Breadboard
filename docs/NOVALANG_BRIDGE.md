# NovaLang Bridge — Contract v2

This file **is** the contract between NovaLang scripts and Breadboard's sim
worker. Any addition, removal or change of a command, argument, return shape
or error code requires a deliberate edit to this file (bump the contract
version in §7) in the same commit as the code change.

Implemented in Phase 4.5: the sim side is `src/worker/bridge.ts`, the script
side `src/nova/host.py`. v2 added `board.resistor` (§7, D-031).

## 1. Shape

- **11 commands** (change the board or advance time), all under `board.*`.
- **3 queries** (read only), all under `sim.*`.
- Every argument and every return value is **JSON-serializable**: strings,
  numbers, booleans, `null`, lists and dicts of those. Scripts never hold
  live references into the sim. A part "handle" is a plain dict.
- Every connection point is a **TerminalRef key**, the same canonical
  strings used everywhere else in Breadboard (see `ARCHITECTURE.md` §4):

  | Kind      | Key form           | Example         |
  | --------- | ------------------ | --------------- |
  | hole      | `hole:<col><row>`  | `"hole:e15"`    |
  | rail hole | `rail:<rail>:<n>`  | `"rail:top+:3"` |
  | part pin  | `pin:<part>:<pin>` | `"pin:U1:14"`   |

  There is no shorthand (`"e15"` is rejected with `BAD_TERMINAL`), so a
  script is never ambiguous and never uses a parallel naming scheme.

Scripts see two globals, `board` and `sim`, which the nova worker binds with
`Nova.expose_global`. Each is a plain dict of functions, one per call below:
`board.wire(...)` works, while `board["_anything"]` and attribute tricks find
nothing. NovaLang's `python.*` namespace is removed. Nothing else is exposed
(see `NOVALANG_ISOLATION.md`, D-032).

## 2. Commands (`board.*`)

Each command is synchronous from the script's point of view. It returns
after the sim worker has applied it.

| #   | Call                             | Effect                                                                                                                                                                                                                                                                                                            | Returns                                    |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `board.new(size)`                | Discard the current circuit and start an empty board. `size` is `"half"` (30 rows) or `"full"` (63 rows).                                                                                                                                                                                                         | `{ "size", "rows", "splitRails" }`         |
| 2   | `board.switch(at)`               | Place an SPDT slide switch. Its three pins occupy `at` and the next two rows in the same column. Pins: `a`, `com`, `b`. It starts at position `0` (`com`–`a` closed).                                                                                                                                             | part handle                                |
| 3   | `board.led(anode, cathode)`      | Place an LED with flexible leads in the two given holes or rail holes. A `pin:` ref is accepted and lands in the nearest free hole joined to that pin, as for `board.wire`. Pins: `anode`, `cathode`.                                                                                                             | part handle                                |
| 4   | `board.chip(type, at)`           | Place a DIP chip with pin 1 at `at`, which must be in column `e`. It straddles the channel: pins 1…n/2 go along column `e`, the rest come back along column `f`. `type` is a part number: `"7400"`, `"7402"`, `"7404"` or `"7408"`, or the same with `HC` (`"74HC00"`, any case). Every chip is the 74HC version. | part handle                                |
| 5   | `board.wire(from, to)`           | Add a jumper wire. Ends are holes or rail holes. A `pin:` ref is accepted: that end goes into the nearest free hole the board joins to the pin's hole (its row strip or rail line). Two pin ends in one strip get two distinct holes.                                                                             | `{ "id", "from", "to" }` (normalized keys) |
| 6   | `board.power(at)`                | Attach the +5 V supply to `at` (normally a rail hole).                                                                                                                                                                                                                                                            | `{ "id", "at", "volts": 5 }`               |
| 7   | `board.ground(at)`               | Attach ground (0 V) to `at`.                                                                                                                                                                                                                                                                                      | `{ "id", "at", "volts": 0 }`               |
| 8   | `board.set(part, value)`         | Set a part's user-controlled state. v1 handles only switches: `value` is `0` (`com`–`a`) or `1` (`com`–`b`).                                                                                                                                                                                                      | `{ "id", "position" }`                     |
| 9   | `board.run(ms)`                  | Advance sim time by `ms` milliseconds (`0 < ms ≤ 10000`). 1 tick = 1 ms; a fractional `ms` rounds up to whole ticks.                                                                                                                                                                                              | `sim.time()` result                        |
| 10  | `board.step(ticks)`              | Advance exactly `ticks` sim ticks (an integer, `1 ≤ ticks ≤ 100000`).                                                                                                                                                                                                                                             | `sim.time()` result                        |
| 11  | `board.resistor(ohms, from, to)` | **v2.** Place a resistor between two holes or rail holes (`pin:` refs as for `board.led`). `ohms` is `100`, `330`, `1000` or `10000`. Pins: `1` (at `from`), `2` (at `to`).                                                                                                                                       | part handle                                |

Part **handle** (returned by `switch`, `led`, `chip`, `resistor`):

```json
{
  "id": "U1",
  "type": "chip74hc00",
  "pins": { "1": "pin:U1:1", "2": "pin:U1:2", "…": "…", "14": "pin:U1:14" },
  "holes": { "1": "hole:e10", "…": "…", "14": "hole:f10" }
}
```

Part ids are assigned by the sim worker (`U<n>` chips, `SW<n>` switches,
`D<n>` LEDs, `R<n>` resistors, `W<n>` wires, `VCC<n>`/`GND<n>` supply leads)
and are stable for the life of the board.

Placement rules (shared with the UI, enforced by the dispatcher): every
hole a part needs must exist on the board and must not already hold
another lead. Each hole holds at most one lead (a part pin or a wire end),
like the real thing; a second lead in the same hole is `OCCUPIED`.

## 3. Queries (`sim.*`)

| #   | Call              | Returns                                                                                                                                                                                                                                                                                                    |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sim.get(target)` | If `target` is a TerminalRef key: the state of its net, `{ "net": "net:…", "level": 0 \| 1 \| "Z" \| "X", "volts": number \| null }`. If `target` is a part id: `{ "id", "type", "state": {…} }`, for example `{ "lit": true }` for an LED or `{ "position": 1 }` for a switch.                            |
| 2   | `sim.snapshot()`  | The whole observable state: `{ "time": {…}, "nets": [ { "id", "level", "volts", "terminals": [keys…] } ], "parts": [ { "id", "type", "state" } ], "wires": [ { "id", "from", "to" } ], "warnings": [ { "code", "message", "at": [keys…] } ] }`. Sorted by id, so equal circuits give byte-equal snapshots. |
| 3   | `sim.time()`      | `{ "ms": number, "ticks": integer }` since the last `board.new`.                                                                                                                                                                                                                                           |

Levels: `0` and `1` are driven logic levels. `"Z"` means floating (nothing
drives the net; a floating chip input also raises a warning). `"X"` means
contention or unknown (between the 74HC thresholds of 1.5 V and 3.5 V).
`volts` is the net's node voltage, or `null` for a floating net. Part
`state` also carries electrical readings: LEDs report `lit`,
`brightness` (0…1), `milliamps` and `burnt`; resistors report `milliamps`.

## 4. Errors

A failed command or query raises in the script. NovaLang surfaces it as a
catchable `PythonError` whose text is `BoardError: <CODE>: <message>`:

```nova
try {
    board.chip("7400", "hole:a10")
} catch e {
    print(e)     # PythonError: BoardError: BAD_PLACEMENT: 74HC00 quad NAND pin 1 must be in column e, got hole:a10
}
```

| Code            | Meaning                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `BAD_ARGS`      | Wrong number or type of arguments, or a value out of range                                          |
| `BAD_TERMINAL`  | Not a valid TerminalRef key, or names a hole or rail not on this board                              |
| `BAD_PLACEMENT` | The footprint does not fit (off the board, chip not in column `e`, …)                               |
| `OCCUPIED`      | A needed hole is already used                                                                       |
| `UNKNOWN_PART`  | No part with that id                                                                                |
| `UNKNOWN_TYPE`  | No chip or part type with that id                                                                   |
| `LIMIT`         | A cap was hit (§6)                                                                                  |
| `TIMEOUT`       | The sim worker did not answer a call (the watchdog's own stop is reported to the panel, not raised) |
| `INTERNAL`      | A bug on the sim side; please report it                                                             |

Commands are **not transactional**. Each command that succeeded before an error stays applied.

## 5. Wire protocol (worker ↔ worker)

What `host.py` sends on the bridge port, and what comes back through the
shared response slot (`src/protocol/sync-buffer.ts`):

```jsonc
// request  (nova worker → sim worker)
{ "v": 2, "id": 42, "op": "board.chip", "args": ["7400", "hole:e10"] }

// response (sim worker → nova worker)
{ "v": 2, "id": 42, "ok": true,  "result": { "id": "U1", "...": "..." } }
{ "v": 2, "id": 42, "ok": false, "error": { "code": "OCCUPIED", "message": "hole:e10 already holds pin:U2:1" } }
```

- `op` is one of the 14 names above. Anything else is `BAD_ARGS`, and
  there is no "eval" or "raw" op.
- `v` is 1 or 2, and the response echoes it. A v1 request may use every op
  except `board.resistor`.
- `args` is always a positional JSON array.
- Responses larger than the shared slot (1 MiB) fail with `LIMIT`.

## 6. Caps

| Cap                         | Value              |
| --------------------------- | ------------------ |
| `board.run` per call        | 10 000 ms sim time |
| `board.step` per call       | 100 000 ticks      |
| Parts per board             | 200                |
| Wires per board             | 1 000              |
| Bridge calls per script run | 100 000            |
| Response size               | 1 MiB              |

The sim worker enforces every cap except the per-run call count, which
`host.py` counts. Together they guarantee **a script cannot hang the sim**:
every command does bounded work and returns.

## 7. Versioning

- Contract version: **2**. It is the `v` field of every message.
- **v2 (Phase 4.5)** added `board.resistor`. Stage-2 electrical (Phase 4)
  burns out an LED driven without a series resistor, so v1 could not build
  a working LED circuit at all (D-031). Every v1 call is unchanged.
- Still absent: part removal, rotation, other resistor values.
- Additions bump `v` and keep old ops working. Removals and changes need
  a migration note here.

## 8. Examples

`public/nova/examples/` holds scripts the scripting panel offers:

- `half_adder.nova` builds a half adder from an empty board: SPDT switches,
  one 74HC00, two LEDs with 330 Ω resistors, with the carry LED sinking into
  NAND(A, B) (D-022).
- `test_vectors.nova` drives that circuit through 00, 01, 10 and 11 with
  `board.set` and `board.run`, checks both LEDs with `sim.get`, and prints
  `PASS` or `FAIL` with details.

A minimal script:

```nova
board.new("half")
board.power("rail:top+:1")
board.ground("rail:top-:1")
let d = board.led("hole:i20", "hole:i21")
board.resistor(330, "rail:top+:20", d["pins"]["anode"])
board.wire(d["pins"]["cathode"], "rail:top-:21")
print(sim.get(d["id"])["state"]["milliamps"])     # 8.691 (mA)
```
