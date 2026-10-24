// Messages between the main thread and the nova worker (Pyodide + NovaLang).

export type NovaRequest =
  /**
   * Sent once with the bridge MessagePort transferred. `base` is the app's base URL
   * (for /pyodide/ and /nova/).
   */
  | {
      readonly kind: 'init';
      readonly base: string;
      readonly bridgeBuffer: SharedArrayBuffer;
      readonly interruptBuffer: SharedArrayBuffer;
    }
  | {
      readonly kind: 'run';
      readonly id: number;
      readonly source: string;
      readonly maxCalls?: number;
    };

export type NovaMessage =
  | {
      readonly kind: 'ready';
      readonly pyodide: string;
      readonly python: string;
      /** Worker globals removed before any script runs (NOVALANG_ISOLATION.md §2). */
      readonly stripped: readonly string[];
      /** `typeof fetch` as a script would see it: must be "undefined". */
      readonly fetchType: string;
      readonly loadMs: number;
    }
  | { readonly kind: 'stdout' | 'stderr'; readonly id: number; readonly text: string }
  | {
      readonly kind: 'done';
      readonly id: number;
      readonly ok: boolean;
      readonly error?: { readonly kind: string; readonly message: string };
      readonly ms: number;
    }
  | { readonly kind: 'fatal'; readonly message: string };

/** Main thread → sim worker: serve the bridge on the transferred port. */
export interface AttachBridge {
  readonly kind: 'attach-bridge';
  readonly buffer: SharedArrayBuffer;
}
