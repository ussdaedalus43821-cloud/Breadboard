# Phase 6 demo — memory, displays, the logic analyzer

Acceptance is encoded in `tests/acceptance/phase6.test.ts`:

- The 74HC74 updates Q only on a rising CLK edge. It does not on a falling
  edge or while CLK stays high, and PRE'/CLR' act at once.
- The switch-clocked flip-flop demo toggles on switch-on, not switch-off.
- The decade counter counts 0, 1, … 9, 0, 1, 2 over twelve manual pulses,
  with no warnings.
- The analyzer's trace of a clock-lead wire is an exact square wave, and
  Q of a toggling flip-flop changes one tick after each rising edge.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

1. **D flip-flop.** Pick **D flip-flop** in the demo list and click **Load
   demo**. Click the switch SW1: the LED comes on (a rising edge). Click
   it again: nothing changes (a falling edge). Click again: off.
2. **Decade counter.** Pick **Decade counter (full board)** and click
   **Load demo**. Click the display once so the inspector follows it.
   Each on-and-off of SW1 adds one: 0 → 9, then back to 0.
3. **Logic analyzer.** **Clear board**, then **CLK lead** → click `a5`.
   **Wire** from `b5` to `b25`. **Select** → click the wire: it gets a
   yellow ①, and the analyzer at the bottom shows a 100 Hz square wave
   scrolling. **Pause** freezes it, and **Step 1 ms** advances it one
   tick. Click the CLK tag to change its frequency in the inspector (1 Hz
   makes the counter count by itself).
4. **Timing.** Load the D flip-flop demo, put a CLK lead on its clock row
   in place of the switch, and probe both the clock wire and the wire off
   Q. Q changes one tick after each rising edge, at half the frequency.
