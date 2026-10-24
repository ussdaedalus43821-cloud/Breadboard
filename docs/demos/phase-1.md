# Phase 1 demo — place parts, drag wires

Acceptance is encoded in `tests/acceptance/phase1.test.ts`. The headline
test places two parts, wires them, and checks the wire's two ends and the
two pins resolve to one net. It does this both through the command
dispatcher and through the editor's click and drag handling.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

1. Click **74HC00**, then hole `e10`. The chip straddles the channel with
   its notch on the left and pin 1 at bottom-left (`e10`). Pins 1–7 run
   along `e10–e16` and pins 8–14 along `f16–f10`.
2. Hover the chip tool over `e12`. The ghost turns red with red pin dots,
   and clicking reports `OCCUPIED: hole:e12 already holds pin:U1:3`.
3. Click **LED**, then `a20` (anode `a20`, cathode `a21`). Click
   **330 Ω**, then `c22` (leads `c22`–`c26`).
4. Click **Wire**. Drag from `j10` to the top red rail: the green wire
   joins pin 14's strip to `+`. Drag from `a21` (the LED's cathode) to
   `c22` (the resistor's pin 1). Both drags start on pins, so the wire
   lands in free holes of those strips.
5. Click **Select** (or press Esc) and right-click any lead of a part or
   wire to remove it. Ids are never reused.
