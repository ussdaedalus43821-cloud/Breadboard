# Breadboard

> **Powered by NovaLang.** The circuit simulator is TypeScript; the scripting
> panel runs [NovaLang](https://github.com/ussdaedalus43821-cloud/Nova_Lang) v2.2.0 (the official interpreter, vendored
> unmodified in `public/nova/`) in your browser through Pyodide, sandboxed
> in a Web Worker. Scripts can build, wire and test circuits through the
> `board`/`sim` bridge (`docs/NOVALANG_BRIDGE.md`).

A real-electronics logic circuit sandbox: place 74HC chips, switches,
LEDs, resistors and a 7-segment display on a breadboard, wire them up and
watch the simulation, or script the board in NovaLang.

```sh
npm install
npm run dev          # http://localhost:5173/
npm run check        # lint, format, tests
npm run build        # static site in dist/
```

Deploying: see `docs/ARCHITECTURE.md` §9. `netlify.toml` and `vercel.json`
set the COOP/COEP headers the NovaLang panel needs.

Docs: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
`docs/NOVALANG_BRIDGE.md`, and a demo script per phase in `docs/demos/`.

## License

Licensed under either of

- Apache License, Version 2.0 ([`LICENSE-APACHE`](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([`LICENSE-MIT`](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option. The SPDX identifier is `MIT OR Apache-2.0`, the same as [NovaLang](https://github.com/ussdaedalus43821-cloud/Nova_Lang).

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Breadboard by you, as defined in the
Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
