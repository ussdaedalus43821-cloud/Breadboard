# Phase 3 demo — a half adder on one 74HC00

Acceptance is encoded in `tests/acceptance/phase3.test.ts`:

- **Propagation delay:** after an input edit, time has not moved and the
  gate output still shows its old value. One `step(1)` later it has the
  new one. In the half adder, each output changes one tick per gate on its
  path (A rising reaches sum in 2 ticks; B rising with A high goes through
  n1 and reaches sum in 3).
- **Truth table:** 00 → sum 0 carry 0, 01 → 1 0, 10 → 1 0, 11 → 0 1,
  settled and with no warnings.
- `board.step` / `board.run` over the protocol, with the bridge's caps.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

**Quick look:** click **Load half-adder demo**, then click **SW1** (A) and
**SW2** (B). D1 (top right) is the sum and D2 (bottom right) is the carry.

**Build it by hand.** Every step uses the palette's default footprints.
"Rail +k" is the k-th hole of the bottom red rail, "rail −k" the bottom
blue one; the top rails are named explicitly.

| #   | Tool          | Action                                                                  |
| --- | ------------- | ----------------------------------------------------------------------- |
| 1   | SPST switch   | click `a3` → SW1 (A)                                                    |
| 2   | SPST switch   | click `a7` → SW2 (B)                                                    |
| 3   | Resistor      | click `c1` → R1, pull-down for A                                        |
| 4   | Resistor      | click `c9` → R2, pull-down for B                                        |
| 5   | Wire          | `b3` → rail +3, `b7` → rail +7, `b1` → rail −2, `b13` → rail −12        |
| 6   | 74HC00        | click `e16` → U1                                                        |
| 7   | Wire          | `j16` → top red rail hole 15 (VCC); `a22` → rail −19 (GND)              |
| 8   | Wire          | `d5`→`d16`, `e5`→`d19`, `d9`→`d17`, `e9`→`j21` (A and B into the gates) |
| 9   | Wire          | `d18`→`d20`, `c20`→`g20`, `d21`→`g18`, `g22`→`g17` (the XOR)            |
| 10  | Resistor, LED | click `h19` (R3), then LED at `i23` (D1 = sum)                          |
| 11  | Wire          | `j24` → top blue rail hole 20                                           |
| 12  | Resistor      | click `a24` (R4); wire `b24` → rail +21                                 |
| 13  | LED           | click `b28` (D2 = carry); wire `c29` → `c18` (cathode sinks into n1)    |

Then **Select** and click the switches through 00, 01, 10, 11.

**See the delay:** click **Pause**, flip a switch, and press **Step 1 ms**
a few times while watching the clock. With A = 1, flipping B from 1 to 0
turns the carry off after 1 ms and the sum on after 3 ms.
