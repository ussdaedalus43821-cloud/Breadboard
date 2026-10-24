# Phase 4 demo — resistors, burn-out, contention

Acceptance is encoded in `tests/acceptance/phase4.test.ts`:

- +5 V → 330 Ω → LED → ground lights normally: 8.7 mA, no warnings.
- The same LED straight across the rails takes ~200 mA, burns out
  (`LED_BURNT`: "current limit exceeded") and goes dark. It stays dead
  after the resistor is added, until it is replaced.
- Two 74HC04 outputs, one driving HIGH and one LOW, wired together raise
  `CONTENTION` (50 mA each way). Through a 330 Ω resistor they draw 11.6 mA
  and raise nothing.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

1. **LED** → click `a20` (anode `a20`, cathode `a21`).
   **330 Ω** → click `c16` (leads `c16`–`c20`).
   **Wire** `b16` → bottom red rail, `b21` → bottom blue rail.
   D1 lights. Hover its anode: `… level X · 2.13 V · D1 8.7 mA`.
2. **LED** → click `a26`. **Wire** `b26` → bottom red rail, `b27` →
   bottom blue rail. D2 cracks and goes dark, and the warning list shows
   `LED_BURNT: D2 burned out: current limit exceeded (197 mA …)`.
3. Swap the 330 Ω for **100 Ω** (right-click to remove): the LED blazes
   at 26 mA with an `OVERCURRENT` warning. **1 kΩ** gives a dim 3 mA, and
   **10 kΩ** a barely visible 0.3 mA.
4. **Contention:** place a **74HC04** at `e10` and wire pin 14 (`j10`) to
   the top red rail and pin 7 (`a16`) to the bottom blue rail. Wire `a10`
   (1A) to the bottom red rail and `a12` (2A) to the bottom blue rail, so
   1Y is low and 2Y is high. Wire `b11` → `b13` to join them: the warning
   list shows `CONTENTION`, 1Y driving low against 2Y driving high, 50.0 mA.
   Remove that wire and join the outputs through **330 Ω** instead: click
   `c13` (leads `c13`–`c17`, from 2Y's row to free row 17), then wire `d17`
   → `d11`. The contention warning clears. (Inputs you left unwired show
   their own `FLOATING_INPUT` warnings.)
