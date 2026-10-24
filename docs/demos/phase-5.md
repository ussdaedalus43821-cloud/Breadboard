# Phase 5 demo — save, share, undo, inspect

Acceptance is encoded in `tests/acceptance/phase5.test.ts`:

- A half adder built by `half_adder.nova` is saved, a brand-new sim (a
  "refresh") loads it, and `test_vectors.nova` prints `PASS` on it.
- Undo/redo for placing and deleting parts (and Clear board, and a whole
  script run as one step). Switch flips are not recorded.
- A shared URL decodes to the same circuit, which then plays its truth
  table.

```sh
npm run check
npm run dev          # http://localhost:5173/
```

1. **Save, refresh, load.** Open **Scripting**, run `half_adder.nova`,
   type a name (say `half adder`) and click **Save**. Reload the page: the
   board is back to empty rails. Pick `half adder` in the list and click
   **Load**. Run `test_vectors.nova`: `PASS`.
2. **Undo/redo.** Place an LED, then press Ctrl+Z (it goes) and Ctrl+Y (it
   comes back). Right-click it to delete it, then Ctrl+Z restores it in the
   same holes with the same id. **Clear board**, **Load**, a script run and
   **Load half-adder demo** each undo as one step. Hover **Undo** to see
   what it will undo.
3. **Share.** Click **Export to URL**. The link (about 720 characters for
   the half adder) is copied and shown in the box. Open it in another
   browser or a private window: the circuit loads, and `test_vectors.nova`
   prints `PASS` there too.
4. **Inspector.** With **Select**, click a resistor. The panel shows its
   value and current. Pick **100 Ω**: in the half adder, the sum LED goes
   from 7.6 mA to 18.2 mA and glows brighter, and the resistor's bands
   turn brown-black-brown. Ctrl+Z puts it back. **Delete** removes the
   selected part.
5. **Wire to two pins in one strip.** From a script:
   `board.wire(d["pins"]["anode"], r["pins"]["1"])` with both pins in row
   10 now lands in two free holes of that row.
