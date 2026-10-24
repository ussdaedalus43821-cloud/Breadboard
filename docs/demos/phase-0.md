# Phase 0 demo — empty board, hole hit-testing

Acceptance is encoded in `tests/acceptance/phase0.test.ts`. This is the
by-hand walkthrough.

```sh
npm install
npm run check        # typecheck + lint + prettier + vitest, all green
npm run dev          # http://localhost:5173/
```

1. A half-size board appears: 30 rows, columns a–j, a centre channel
   between e and f, and four rails (red +, blue −) in groups of 5.
2. Click any hole. It turns orange and the status line shows its
   TerminalRef key, for example `hole:e15` or `rail:top+:3`.
3. Click a rail gap, the centre channel or the margin. The status line
   reads "No hole there".
4. Open `http://localhost:5173/?size=full` to see the 63-row board.
