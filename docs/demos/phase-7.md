# Phase 7 demo — zoom, the clock inspector, contract v3, deployment

Acceptance is encoded in `tests/acceptance/phase7.test.ts` and
`src/ui/canvas/viewport.test.ts`:

- Bridge contract v3: `board.display` returns its segment pins,
  `board.clock` toggles at the given rate, and v1/v2 requests keep every
  call they had but are refused the two new ones.
- `clock_display.nova` blinks a segment from a 2 Hz CLK lead, run through
  the real NovaLang under Pyodide.
- The clocked counter demo counts once a second at 1 Hz, and once every
  100 ms after its clock is set to 10 Hz.
- `netlify.toml` parses as TOML, and it and `vercel.json` send
  COOP `same-origin` and COEP `require-corp` on every path.
- Zooming keeps the point under the cursor still; zoom and pan are clamped.

```sh
npm run check
npm run build        # compiles to dist/
npm run dev          # http://localhost:5173/
```

1. **Start here.** On a first visit a dialog says "Welcome to Breadboard.
   Load a demo to get started, or click parts to build." Click **Load the
   counter demo**. (It stays closed on later visits; **?** brings it back.)
2. **Zoom.** Put the mouse over the 7-segment display and scroll up: the
   board zooms in around the display (the readout shows e.g. 165%).
   Middle-drag, or hold Space and drag, to pan. **Fit** (or `0`) shows the
   whole board again.
3. **Change the clock.** The display counts once a second. With **Select**,
   click the green **CLK** tag (bottom row, left of hole `a47`). The
   inspector shows `CLK1 · clock lead` and a **Frequency** menu from 1 Hz to
   500 Hz. Choose **10 Hz**: the display counts ten times as fast.
4. **Script it.** Open **Scripting (NovaLang)**, pick `clock_display.nova`
   and **Run**: it prints `g lit: [true, false, …]` as segment g blinks at
   2 Hz.
5. **Deploy.** Connect the repo to Netlify (or Vercel): the build command,
   `dist/` and the COOP/COEP headers come from `netlify.toml` /
   `vercel.json`. On the deployed site, the NovaLang panel starts, which
   proves the page is cross-origin isolated (`crossOriginIsolated` is
   `true` in the console).

The browser run of steps 1–3 (Playwright) read the display through the
inspector at 1 Hz as `1 1 2 2 3 4 4 5` (sampled every ~0.5 s) and, after
switching to 10 Hz, as `9 0 1 2 3 4 6 7 8 9 0 1` (every ~0.1 s), with no
page errors.
