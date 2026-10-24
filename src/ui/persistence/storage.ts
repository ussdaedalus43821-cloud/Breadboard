// Named circuit saves in this browser's localStorage. Storage can be missing or
// throw (private mode, blocked site data), so every access is guarded.

const KEY = 'breadboard:circuit:';

export interface StoredCircuit {
  readonly name: string;
  readonly savedAt: string;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function listSaves(): StoredCircuit[] {
  const s = store();
  if (!s) return [];
  const out: StoredCircuit[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(KEY)) continue;
      const meta = (JSON.parse(s.getItem(k) ?? '{}') as { meta?: { created?: string } }).meta;
      out.push({ name: k.slice(KEY.length), savedAt: meta?.created ?? '' });
    }
  } catch {
    /* a corrupt entry is skipped, not fatal */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns an error message, or null on success. */
export function writeSave(name: string, save: unknown): string | null {
  const s = store();
  if (!s) return 'this browser is not letting the page store data';
  try {
    s.setItem(KEY + name, JSON.stringify(save));
    return null;
  } catch (e) {
    return `could not save: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function readSave(name: string): unknown {
  try {
    const raw = store()?.getItem(KEY + name);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteSave(name: string): void {
  try {
    store()?.removeItem(KEY + name);
  } catch {
    /* nothing to do */
  }
}

const WELCOMED = 'breadboard:welcomed';

/** Whether this browser has dismissed the "Start here" welcome. */
export function welcomeSeen(): boolean {
  try {
    return store()?.getItem(WELCOMED) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    store()?.setItem(WELCOMED, '1');
  } catch {
    // Not remembered: the welcome shows again next visit.
  }
}
