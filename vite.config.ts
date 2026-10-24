/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Cross-origin isolation (COOP + COEP) is required for the SharedArrayBuffer
// bridge between the NovaLang worker and the sim worker. See
// docs/ARCHITECTURE.md §3. Production hosting must send the same headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
