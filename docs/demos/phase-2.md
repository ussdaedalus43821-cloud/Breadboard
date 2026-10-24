# Phase 2 demo — the LED lights

Acceptance is encoded in `tests/acceptance/phase2.test.ts`:

- The switch → resistor → LED circuit, wired from the 5 V rail, lights
  only while the switch is closed. This is checked through the sim-worker
  protocol and again through the editor's own clicks and drags.
- An unwired 74HC00 reports all eight inputs as `FLOATING_INPUT` (and the
  chip as `CHIP_UNPOWERED`). Wiring all but one input leaves exactly one
  warning.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

The board starts with `+5V` and `GND` leads on the left end of every rail.

1. **SPST switch** → click `b3` (pins `b3`, `b5`).
2. **Wire** → drag from the top red rail's 2nd hole to `a3`.
3. **330 Ω** → click `d5` (leads `d5`–`d9`).
4. **LED** → click `c9` (anode `c9`, cathode `c10`).
5. **Wire** → drag from `a10` to the bottom blue rail's 2nd hole.
6. **Select** → click the switch. The knob slides right and turns green,
   the LED lights, and the pin dots on the switch, resistor and anode turn
   red (logic 1). Click the switch again and the LED goes dark.
7. Hover any hole: the line under the status shows its net and level,
   e.g. `hole:e9 · net:hole:a9 · level 1`.
8. **74HC00** → click `e18`. Yellow rings mark eight floating inputs and
   two unpowered supply pins, and each is listed under the board.
