# NovaLang Bridge — Contract v1

This file **is** the contract between NovaLang scripts and Breadboard's sim
worker. Any addition, removal or change of a command, argument, return shape
or error code requires a deliberate edit to this file (bump the contract
version in §7) in the same commit as the code change.

Implemented in Phase 4.5. Until then this document is the target.

## 1. Shape

- **10 commands** (change the board or advance time), all under `board.*`.
- **3 queries** (read only), all under `sim.*`.
- Every argument and every return value is **JSON-serializable**: strings,
  numbers, booleans, `null`, lists and dicts of those. Scripts never hold
  live references into the sim. A part "handle" is a plain dict.
- Every connection point is a **TerminalRef key**, the same canonical
  strings used everywhere else in Breadboard (see `ARCHITECTURE.md` §4):

  | Kind      | Key form          | Example        |
  | --------- | ----------------- | -------------- |
  | hole      | `hole:<col><row>` | `"hole:e15"`   |
  | rail hole | `rail:<rail>:<n>` | `"rail:top+:3"`|
  | part pin  | `pin:<part>:<pin>`| `"pin:U1:14"`  |

  There is no shorthand (`"e15"` is rejected with `BAD_TERMINAL`), so a
  script is never ambiguous and never uses a parallel naming scheme.

Scripts see two globals, `board` and `sim`, which the nova worker binds with
`Nova.expose_global`. Nothing else is exposed (see `NOVALANG_ISOLATION.md`).

## 2. Commands (`board.*`)

Each command is synchronous from the script's point of view. It returns
after the sim worker has applied it.

| # | Call | Effect | Returns |
| - | ---- | ------ | ------- |
| 1 | `board.new(size)` | Discard the current circuit and start an empty board. `size` is `"half"` (30 rows) or `"full"` (63 rows). | `{ "size", "rows", "splitRails" }` |
| 2 | `board.switch(at)` | Place an SPDT slide switch. Its three pins occupy `at` and the next two rows in the same column. Pins: `a`, `com`, `b`. It starts at position `0` (`com`–`a` closed). | part handle |
| 3 | `board.led(anode, cathode)` | Place an LED with flexible leads in the two given holes. Pins: `anode`, `cathode`. | part handle |
| 4 | `board.chip(type, at)` | Place a DIP chip with pin 1 at `at`, which must be in column `e`. It straddles the channel: pins 1…n/2 go down column `e`, the rest come back up column `f`. `type` is a chip id such as `"7400"`, `"7402"`, `"7404"` or `"7408"` (the available set grows from Phase 3). | part handle |
| 5 | `board.wire(from, to)` | Add a jumper wire. Ends are holes or rail holes. A `pin:` ref is accepted and normalized to the hole that pin occupies. | `{ "id", "from", "to" }` (normalized keys) |
| 6 | `board.power(at)` | Attach the +5 V supply to `at` (normally a rail hole). | `{ "id", "at", "volts": 5 }` |
| 7 | `board.ground(at)` | Attach ground (0 V) to `at`. | `{ "id", "at", "volts": 0 }` |
| 8 | `board.set(part, value)` | Set a part's user-controlled state. v1 handles only switches: `value` is `0` (`com`–`a`) or `1` (`com`–`b`). | `{ "id", "position" }` |
| 9 | `board.run(ms)` | Advance sim time by `ms` milliseconds (`0 < ms ≤ 10000`). | `sim.time()` result |
| 10 | `board.step(ticks)` | Advance exactly `ticks` sim ticks (an integer, `1 ≤ ticks ≤ 100000`). | `sim.time()` result |

Part **handle** (returned by `switch`, `led`, `chip`):

```json
{
  "id": "U1",
  "type": "chip7400",
  "pins": { "1": "pin:U1:1", "2": "pin:U1:2", "…": "…", "14": "pin:U1:14" },
  "holes": { "1": "hole:e10", "…": "…", "14": "hole:f10" }
}
```

Part ids are assigned by the sim worker (`U<n>` chips, `SW<n>` switches,
`D<n>` LEDs, `W<n>` wires) and are stable for the life of the board.

Placement rules (shared with the UI, enforced by the dispatcher): every
hole a part needs must exist on the board and must not already hold
another lead. Each hole holds at most one lead (a part pin or a wire end),
like the real thing; a second lead in the same hole is `OCCUPIED`.

## 3. Queries (`sim.*`)

| # | Call | Returns |
| - | ---- | ------- |
| 1 | `sim.get(target)` | If `target` is a TerminalRef key: the state of its net, `{ "net": "net:…", "level": 0 \| 1 \| "Z" \| "X", "volts": number \| null }`. If `target` is a part id: `{ "id", "type", "state": {…} }`, for example `{ "lit": true }` for an LED or `{ "position": 1 }` for a switch. |
| 2 | `sim.snapshot()` | The whole observable state: `{ "time": {…}, "nets": [ { "id", "level", "volts", "terminals": [keys…] } ], "parts": [ { "id", "type", "state" } ], "wires": [ { "id", "from", "to" } ], "warnings": [ { "code", "message", "at": [keys…] } ] }`. Sorted by id, so equal circuits give byte-equal snapshots. |
| 3 | `sim.time()` | `{ "ms": number, "ticks": integer }` since the last `board.new`. |

Levels: `0` and `1` are driven logic levels. `"Z"` means floating (nothing
drives the net; a floating chip input also raises a warning). `"X"` means
contention or unknown (two drivers disagree). `volts` is `null` until
Stage-2 electrical (Phase 4).

## 4. Errors

A failed command or query raises in the script. NovaLang surfaces it as a
catchable error whose text begins `BoardError: <CODE>:`:

```nova
try {
    board.chip("7400", "hole:a10")
} catch e {
    print(e)     # ... BoardError: BAD_PLACEMENT: chip pin 1 must be in column e, got hole:a10
}
```

| Code | Meaning |
| ---- | ------- |
| `BAD_ARGS` | Wrong number or type of arguments, or a value out of range |
| `BAD_TERMINAL` | Not a valid TerminalRef key, or names a hole or rail not on this board |
| `BAD_PLACEMENT` | The footprint does not fit (off the board, chip not in column `e`, …) |
| `OCCUPIED` | A needed hole is already used |
| `UNKNOWN_PART` | No part with that id |
| `UNKNOWN_TYPE` | No chip or part type with that id |
| `LIMIT` | A cap was hit (§6) |
| `TIMEOUT` | The watchdog stopped the script (see `NOVALANG_ISOLATION.md`) |

Commands are **not transactional**, matching NovaLang's own `python.*`
semantics. Each command that succeeded before an error stays applied.

## 5. Wire protocol (worker ↔ worker)

What the Python proxy sends on the port, and what comes back through the
shared response slot:

```jsonc
// request  (nova worker → sim worker)
{ "v": 1, "id": 42, "op": "board.chip", "args": ["7400", "hole:e10"] }

// response (sim worker → nova worker)
{ "v": 1, "id": 42, "ok": true,  "result": { "id": "U1", "...": "..." } }
{ "v": 1, "id": 42, "ok": false, "error": { "code": "OCCUPIED", "message": "hole:e10 already holds pin:U2:1" } }
```

- `op` is one of the 13 names above. Anything else is `BAD_ARGS`, and
  there is no "eval" or "raw" op.
- `args` is always a positional JSON array.
- Responses larger than the shared slot (1 MiB) fail with `LIMIT`.

## 6. Caps

| Cap | Value |
| --- | ----- |
| `board.run` per call | 10 000 ms sim time |
| `board.step` per call | 100 000 ticks |
| Parts per board | 200 |
| Wires per board | 1 000 |
| Bridge calls per script run | 100 000 |
| Response size | 1 MiB |

Caps are sim-worker-enforced and are what guarantees **a script cannot
hang the sim**: every command does bounded work and returns.

## 7. Versioning

- Contract version: **1**. It is the `v` field of every message.
- Deliberately absent from v1: `board.resistor`, part removal, rotation.
  `board.resistor` is the expected first edit (Phase 4).
- Additions bump `v` and keep old ops working. Removals and changes need
  a migration note here.

## 8. Example — AND-gate truth table (half-adder carry)

```nova
board.new("half")
board.power("rail:top+:1")
board.ground("rail:top-:1")

let a = board.switch("hole:a3")
let b = board.switch("hole:a7")
let u1 = board.chip("7408", "hole:e12")       # available once Phase 3 adds it
# ... wire each switch's a/b throws to the rails, com to u1 pins 1 and 2,
#     pin 14 to +5 V, pin 7 to ground, an LED on pin 3 ...

for pa in [0, 1] {
    for pb in [0, 1] {
        board.set(a["id"], pa)
        board.set(b["id"], pb)
        board.run(1)
        print(pa, pb, "->", sim.get(u1["pins"]["3"])["level"])
    }
}
```
