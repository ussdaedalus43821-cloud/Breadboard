# Phase 4.5 demo — NovaLang builds and tests the half adder

Acceptance is encoded in `tests/acceptance/phase45.test.ts`, which runs the
real vendored NovaLang under Pyodide in Node against the real sim:

1. `public/nova/examples/half_adder.nova` builds the half adder from an
   empty board: 2 SPDT switches, one 74HC00, 2 LEDs and 2 resistors, 16
   wires, 4 supply leads, and no warnings.
2. `public/nova/examples/test_vectors.nova` drives it through 00, 01, 10
   and 11 with `board.set` and `board.run`, checks both LEDs with
   `sim.get`, and prints `PASS`. A sabotaged circuit makes it print
   `FAIL`.

Isolation is in `tests/acceptance/phase45-isolation.test.ts`.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

1. Click **Scripting (NovaLang)** under the board. Pyodide loads now (about
   2 s, about 13 MB the first time), and not before. The status line turns
   green, and hovering it lists the network and storage globals removed
   from the worker.
2. **Example** → `half_adder.nova` → **Run script**. The board clears and
   fills with the circuit, and the output reads
   `half adder built: SW1 = A, SW2 = B, D1 = sum, D2 = carry`.
3. **Example** → `test_vectors.nova` → **Run script**. Four `ok` lines,
   then `PASS`. The board ends on A = B = 1 with the carry LED lit.
4. Click the switches yourself (Select tool) to replay the truth table by
   hand.
5. **Watchdog:** replace the script with `while true { }`, set the timeout
   to 1000, and run. It stops after about 1 s with
   `TIMEOUT: the script ran too long and was stopped`. Run anything
   afterwards and it works. `sleep(20000)` ignores the soft stop, so it is
   killed 1 s later (`TIMEOUT (killed)`). The next run starts a fresh
   worker, taking about 1.5 s.
6. **Isolation:** `print(python)` fails with `undefined name 'python'`, and
   `print(board["_bridge"])` finds no such key.
