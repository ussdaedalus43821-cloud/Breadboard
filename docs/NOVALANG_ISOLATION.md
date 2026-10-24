# NovaLang Isolation

What a NovaLang script running inside Breadboard **cannot** do, and which
layer makes each guarantee true. A script may be something the user wrote,
pasted from a forum, or loaded from a shared URL. Treat every script as
untrusted.

The Phase 0 draft of this file relied on NovaLang's own _Security_ section
(`python.*` as "a deliberate, narrow bridge") and on its live object proxy
hiding underscore names. Phase 4.5 tested both under Pyodide and neither
holds up (D-032):

- **Object proxies leak internals.** `expose_global(name, obj)` resolves
  any attribute on a lookup, underscores and dunders included (only listing
  keys hides them), and can set any attribute.
- **`python.*` reaches dunders.** `python.get("json.__builtins__")` returns
  Python's `builtins`, `__import__` included. Allowlisted modules re-export
  others (`statistics.sys`), which leads to `sys.modules` and from there to
  Pyodide's `js` module, which runs arbitrary JavaScript in the worker.

So Breadboard does not depend on either. The walls below are Breadboard's
own, in `src/nova/host.py` and `src/nova/worker.ts`. The vendored NovaLang
files are unmodified, and the issues above are NovaLang's to fix upstream.

## 1. What a script can do

- Run NovaLang: the language and its built-in functions (`print`, `len`,
  `range`, `str`, `sqrt`, `random`, `json.dumps`/`loads`, …).
- Call the 11 `board.*` commands and 3 `sim.*` queries in
  [`NOVALANG_BRIDGE.md`](NOVALANG_BRIDGE.md), with JSON values in and out.
- Read and write files in a throwaway in-memory filesystem (§2).
- `print`, which goes to the scripting panel's output.

That is the whole list. In particular, **there is no `python.*`**.

## 2. What a script cannot do

| A script cannot…                                                                                                      | Why it can't                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use `python.import`, `python.get`, `python.call` or `python.set`                                                      | `host.py` deletes the `python` global from every engine it creates. Modules a script `import`s start from NovaLang's fresh, empty globals, so they never see it either.                                                                                                                                                                                                                                                                   |
| Reach any Python object                                                                                               | `board` and `sim` are **plain dicts of functions**, not objects. NovaLang can call a function but never index it or read its attributes ("a function cannot be indexed"), and a dict is copied into the script. So `board["_bridge"]`, `board["__class__"]` and `board.new.__globals__` all fail. Every return value is fresh JSON data (dicts, lists, strings, numbers, booleans). Overwriting `board.new` changes only that run's copy. |
| Touch `window`, `document`, the DOM, `localStorage`, `sessionStorage`, cookies                                        | It runs in a dedicated Web Worker, which has none of them. The main thread never evaluates script text and shows worker output only as text.                                                                                                                                                                                                                                                                                              |
| Use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` | The nova worker removes these globals after Pyodide and NovaLang have loaded and **before** any script runs, and reports the result (`typeof fetch` is `"undefined"`; the panel's status tooltip lists it). Pyodide's `loadPackage` is replaced with a function that throws.                                                                                                                                                              |
| Read the user's or the server's files                                                                                 | NovaLang's `read`/`write`/`listdir`/… reach only Pyodide's in-memory Emscripten filesystem. It is never synced anywhere and is discarded with the worker. `input()` sees end-of-input and raises NovaLang's catchable "found no more input".                                                                                                                                                                                              |
| Touch the solver, tick loop, netlist, circuit or renderer                                                             | Those live in the **sim worker**, a different thread and heap. The only way in is the JSON bridge. The sim worker checks every request (op on the fixed list, argument count and types, TerminalRefs parsed and bounds-checked) and refuses anything else with `BAD_ARGS`. There is no `eval` or raw op.                                                                                                                                  |
| Hang the sim                                                                                                          | Every bridge call does bounded work (`board.run` ≤ 10 000 ms of sim time, `board.step` ≤ 100 000 ticks, 200 parts, 1 000 wires, 100 000 calls per run; `NOVALANG_BRIDGE.md` §6). The sim worker never waits on the nova worker, and the UI keeps rendering while a script runs.                                                                                                                                                           |
| Crash Pyodide by recursing                                                                                            | NovaLang raises Python's recursion limit to 20 000 on import, past what Pyodide's WebAssembly stack holds. `host.py` restores Pyodide's own limit (1 000), so runaway recursion is a caught `RecursionError`. If Pyodide fails anyway, the worker reports `fatal` and the main thread replaces it.                                                                                                                                        |
| Hang the page, or itself forever                                                                                      | The **watchdog** (§3).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Carry state between runs                                                                                              | Each run gets a fresh `Nova()` engine and fresh `board`/`sim` dicts. The only lasting effect of a script is the circuit it built.                                                                                                                                                                                                                                                                                                         |

## 3. Watchdog

NovaLang's embedding API has no step limit or timeout, so the main thread
(`src/ui/nova-client.ts`) enforces one from outside:

1. **Soft stop at `N` ms** (default 5 000, set in the panel, at most
   60 000). The main thread writes SIGINT (2) into Pyodide's interrupt
   buffer, a `SharedArrayBuffer`. Python raises `KeyboardInterrupt` at its
   next check. NovaLang does not catch it on the embedding path, so
   `host.py` reports `TIMEOUT: the script ran too long and was stopped`
   and the worker stays warm.
2. **Hard kill at `N` + 1 000 ms.** If the soft stop has not returned
   control (for example, inside `sleep()`), the main thread calls
   `worker.terminate()`. The panel shows `TIMEOUT (killed)`, and the next
   run starts a fresh worker (about 1.5 s, with Pyodide from the browser
   cache). **Stop** in the panel does the same kill at once.
3. A killed script may have been blocked in `Atomics.wait` on a bridge
   call. The sim worker answers and moves on, so it is unaffected. Commands
   that already completed stay applied (the bridge is not transactional).
4. The script's clock is the sim's: the real-time 1 kHz clock is paused
   while a script runs (D-023), and resumes afterwards if it was running.

## 4. Things that are deliberately _not_ isolation

- **Determinism is not a security property.** NovaLang's `random()` is
  available.
- **No rollback.** An error partway through leaves earlier successful
  commands applied. Undo arrives in Phase 5.
- **CPU use inside the time limit is allowed.** A script may burn its full
  `N` ms on its own thread.
- **Dynamic `import()` cannot be removed from a worker.** Reaching it needs
  JavaScript execution, which needs a Python object, which §2 denies. As
  defence in depth, production hosting should send a Content-Security-Policy
  that limits `script-src`, `connect-src` and `worker-src` to `'self'` (plus
  `'wasm-unsafe-eval'` for Pyodide).

## 5. Invariants to keep when changing code

- Never bind a Python **object** into a script. `board`/`sim` stay dicts
  of functions whose keys are exactly the bridge calls.
- Never put `python` back, never call `Nova.expose`, `expose_module` or
  `expose_global` with anything but those two dicts.
- Never return anything from a bridge function but parsed JSON.
- Never add a bridge `op` that takes code, a path, a URL or a key into sim
  internals.
- Strip the network/storage globals **after** loading and **before** the
  first script.
- Never modify the vendored NovaLang files, to tighten or to loosen.
  Isolation lives in Breadboard's host code.

Tests: `tests/acceptance/phase45-isolation.test.ts` covers the missing
`python.*` (also through `import`), each escape attempt above, the
recursion limit, the call cap, `input()`, the in-memory filesystem, the
watchdog's soft stop (a Node worker thread plays the watchdog), the
public surface (exactly the contract's calls), and the vendored files'
hashes. `src/worker/bridge.test.ts` covers the dispatcher's refusals. The
browser run (`docs/demos/phase-4.5.md`) checks `typeof fetch` in the
worker, the hard kill and recovery, the Stop button, and that nothing is
requested from outside the site.
