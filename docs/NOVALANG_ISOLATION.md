# NovaLang Isolation

What a NovaLang script running inside Breadboard **cannot** do, and which
layer makes each guarantee true. This follows NovaLang's own *Security*
section: `python.*` is "a deliberate, narrow bridge, not unrestricted
access to the host process". Breadboard keeps that bridge exactly as
narrow and adds browser-level walls around it.

A script may be something the user wrote, pasted from a forum, or loaded
from a shared URL. Treat every script as untrusted.

## 1. What a script can do

- Run NovaLang: its language, its standard library, and the
  pure-computation modules on NovaLang's own `python.import` allowlist
  (`math`, `random`, `statistics`, `itertools`, `functools`, `string`,
  `re`, `datetime`, `json`, `collections`).
- Call the 10 `board.*` commands and 3 `sim.*` queries in
  [`NOVALANG_BRIDGE.md`](NOVALANG_BRIDGE.md), with JSON values in and out.
- `print`, which goes to the scripting panel's console.

That is the whole list.

## 2. What a script cannot do

| A script cannot… | Why it can't |
| ---------------- | ------------ |
| Touch `window`, `document`, the DOM, `localStorage`, `sessionStorage`, cookies | It runs in a dedicated Web Worker, which has no `window`, DOM or Web Storage. The main thread never evaluates script-provided strings. |
| Use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` | The nova worker deletes or overrides these globals after Pyodide and the vendored NovaLang files have loaded, and **before** any user script runs. Pyodide's package loader is disabled at the same point (`loadPackage`/`micropip` are unavailable). |
| `python.import("os")`, `"sys"`, `"subprocess"`, `"js"`, `"pyodide"`, … | NovaLang's own `PYTHON_IMPORT_ALLOWLIST` refuses them with `PythonError`. Breadboard never calls `Nova.expose_module`, so the allowlist is never widened. `js` and `pyodide`, the two modules that would reach the worker's JavaScript, are specifically never exposed. |
| Reach Python objects beyond `board` and `sim` | Only those two are bound, with `expose_global`. NovaLang's live proxy exposes only `dir()`-visible, non-underscore attributes, so the proxy classes keep **every** internal (port, buffers, counters) underscore-prefixed. Their public surface is exactly the 13 bridge calls. Every return value is a fresh plain `dict`/`list`/`str`/number, never a live object. |
| Read or write the user's files | NovaLang's `read`/`write`/`exists` reach only Pyodide's in-memory Emscripten filesystem: a scratch directory that starts empty, is never synced to IndexedDB, and is discarded when the worker restarts. `input()` raises. |
| Touch the solver, tick loop, netlist, circuit object or renderer | Those live in the **sim worker**, a different thread with a different heap. The only path in is the JSON bridge, and the sim worker validates every request (`op` on the fixed list, `args` type-checked, TerminalRefs parsed and bounds-checked) before acting. There is no `eval` op. |
| Hang the sim | Every bridge command does bounded work (`board.run` ≤ 10 000 ms of sim time, `board.step` ≤ 100 000 ticks, part and wire caps; see `NOVALANG_BRIDGE.md` §6). The sim worker stays responsive to the UI between bridge calls, and the UI keeps rendering while a script runs. |
| Hang the page, or itself forever | The **watchdog** (§3). |
| Survive its own crash with state | Each run starts from a fresh `Nova()` instance. Nothing a script defines carries over to the next run. The only persistent effect of a script is the circuit it built through `board.*`. |

## 3. Watchdog

NovaLang's embedding API has no step limit or timeout, so the limit is
enforced from outside the nova worker:

1. **Soft stop at `N` ms** (default `N = 5000` wall-clock ms per run;
   configurable in the panel, max 60 000). The main thread writes `SIGINT`
   (2) into Pyodide's interrupt buffer (`pyodide.setInterruptBuffer`, a
   `SharedArrayBuffer`). Python raises `KeyboardInterrupt` at its next
   bytecode check, the host runner reports `TIMEOUT`, and the worker stays
   warm.
2. **Hard kill at `N + 1000` ms.** If the soft stop has not returned
   control (for example, stuck in a long native call), the main thread
   calls `worker.terminate()` on the nova worker. This is the only kill
   that always works. The panel reports `TIMEOUT (killed)`. The next run
   spawns a fresh worker, which reloads Pyodide from the browser cache.
3. A killed script may have been blocked in `Atomics.wait` on a bridge
   call. The sim worker never waits on the nova worker. It answers
   requests and moves on, so killing the nova worker leaves the sim intact.
   Any commands that already completed stay applied (the bridge is not
   transactional, see `NOVALANG_BRIDGE.md` §4).
4. The bridge-call cap (100 000 per run) catches runaway loops of cheap
   calls before the wall-clock limit does.

## 4. Things that are deliberately *not* isolation

- **Determinism is not a security property.** `random` is allowed. Scripts
  that want reproducibility seed it themselves.
- **No rollback.** As in NovaLang, an error partway through leaves earlier
  successful commands applied. The user can undo (Phase 5).
- **CPU use inside the time limit is allowed.** A script may burn its full
  `N` ms. It runs on its own thread, so it only slows itself.

## 5. Invariants to keep when changing code

- Never call `Nova.expose_module`, and never bind anything but `board` and
  `sim` as globals.
- Never add a public (non-underscore) attribute to the Python proxy classes
  that is not a bridge call listed in `NOVALANG_BRIDGE.md`.
- Never add a bridge `op` that takes code, a path, a URL, or an arbitrary
  key into sim internals.
- Strip the network/storage globals **after** loading and **before** the
  first user script. A test asserts `typeof fetch === 'undefined'` inside
  the worker at script time.
- Never modify the vendored NovaLang files to tighten or loosen any of
  this. Isolation lives in Breadboard's host code.

Each invariant gets a Vitest test in Phase 4.5
(`tests/acceptance/phase45-isolation.test.ts`): `python.import("os")` is
refused, `fetch` is undefined, a `while true {}` script is stopped and a
second script then runs normally, an unknown `op` is `BAD_ARGS`, and the
proxy's `dir()` equals the bridge list.
