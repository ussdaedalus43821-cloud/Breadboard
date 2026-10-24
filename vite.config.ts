/// <reference types="vitest/config" />
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Cross-origin isolation (COOP + COEP) is required for the SharedArrayBuffer
// bridge between the NovaLang worker and the sim worker. See
// docs/ARCHITECTURE.md §3. Production hosting must send the same headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Serve Pyodide from node_modules at /pyodide/ (dev) and copy it into the build,
 * so the nova worker loads it same-origin: no CDN, versioned by package-lock.
 */
function pyodideAssets(): Plugin {
  const dir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));
  const files = [
    'pyodide.mjs',
    'pyodide.asm.mjs',
    'pyodide.asm.wasm',
    'python_stdlib.zip',
    'pyodide-lock.json',
  ];
  const types: Record<string, string> = {
    mjs: 'text/javascript',
    wasm: 'application/wasm',
    zip: 'application/zip',
    json: 'application/json',
  };
  return {
    name: 'breadboard:pyodide-assets',
    configureServer(server) {
      server.middlewares.use('/pyodide', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (!files.includes(name)) return next();
        const path = join(dir, name);
        res.setHeader('Content-Type', types[name.split('.').pop()!] ?? 'application/octet-stream');
        res.setHeader('Content-Length', statSync(path).size);
        for (const [k, v] of Object.entries(crossOriginIsolation)) res.setHeader(k, v);
        createReadStream(path).pipe(res);
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `pyodide/${name}`,
          source: readFileSync(join(dir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [pyodideAssets()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // Pyodide takes a second or two to load per test file.
    hookTimeout: 60_000,
  },
});
