// The scripting panel: pick or write a NovaLang script, run it, read its output.
// Pyodide loads the first time the panel opens, never at start-up.

import type { CircuitHost } from '../../protocol/circuit-host';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, type NovaClient } from '../nova-client';

export const EXAMPLES = ['half_adder.nova', 'test_vectors.nova'] as const;

export interface ScriptingPanelElements {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly example: HTMLSelectElement;
  readonly source: HTMLTextAreaElement;
  readonly run: HTMLButtonElement;
  readonly stop: HTMLButtonElement;
  readonly timeout: HTMLInputElement;
  readonly status: HTMLElement;
  readonly output: HTMLElement;
}

export function mountScriptingPanel(
  el: ScriptingPanelElements,
  client: NovaClient,
  host: CircuitHost,
  isClockRunning: () => boolean,
  base: string,
): void {
  const say = (text: string, tone: 'info' | 'ok' | 'error' = 'info'): void => {
    el.status.textContent = text;
    el.status.dataset['tone'] = tone;
  };
  const print = (text: string, stream: 'stdout' | 'stderr' | 'meta'): void => {
    const line = document.createElement('div');
    line.className = stream;
    line.textContent = text;
    el.output.append(line);
    el.output.scrollTop = el.output.scrollHeight;
  };

  for (const name of EXAMPLES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    el.example.append(option);
  }
  el.timeout.value = String(DEFAULT_TIMEOUT_MS);
  el.timeout.max = String(MAX_TIMEOUT_MS);

  const loadExample = async (name: string): Promise<void> => {
    const res = await fetch(`${base}nova/examples/${name}`);
    el.source.value = res.ok ? await res.text() : `# could not load ${name}: HTTP ${res.status}`;
  };
  el.example.addEventListener('change', () => void loadExample(el.example.value));

  let started = false;
  el.toggle.disabled = false; // enabled only once the handlers below exist
  el.toggle.addEventListener('click', () => {
    el.panel.hidden = !el.panel.hidden;
    el.toggle.setAttribute('aria-expanded', String(!el.panel.hidden));
    if (el.panel.hidden || started) return;
    started = true;
    void loadExample(el.example.value);
    say('Loading Python (Pyodide, about 13 MB the first time)…');
    el.run.disabled = true;
    client.start().then(
      (info) => {
        say(
          `Ready: NovaLang on Python ${info.python} (Pyodide ${info.pyodide}), loaded in ${info.loadMs} ms.`,
          'ok',
        );
        el.status.title = `Removed before any script runs: ${info.stripped.join(', ')}. typeof fetch in the worker: ${info.fetchType}.`;
        el.run.disabled = false;
      },
      (e: unknown) => {
        say(`Scripting unavailable: ${e instanceof Error ? e.message : String(e)}`, 'error');
        started = false;
        el.run.disabled = false;
      },
    );
  });

  el.run.addEventListener('click', async () => {
    if (client.running) return;
    el.output.replaceChildren();
    el.run.disabled = true;
    el.stop.disabled = false;
    say('Running…');
    // Scripts move time only with board.run / board.step (D-023).
    const wasRunning = isClockRunning();
    await host.setRunning(false);
    await host.group(true, 'script run'); // one Ctrl+Z undoes the whole run
    try {
      const result = await client.run(el.source.value, {
        timeoutMs: Number(el.timeout.value) || DEFAULT_TIMEOUT_MS,
        onStdout: (t) => print(t, 'stdout'),
        onStderr: (t) => print(t, 'stderr'),
      });
      if (result.ok) {
        say(`Finished in ${result.ms} ms.`, 'ok');
      } else {
        print(result.message ?? 'failed', 'stderr');
        say(
          result.kind === 'stopped'
            ? 'Stopped.'
            : result.kind === 'timeout' || result.kind === 'killed'
              ? 'Stopped by the watchdog.'
              : 'The script failed.',
          'error',
        );
      }
    } catch (e) {
      say(`Scripting unavailable: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      el.run.disabled = false;
      el.stop.disabled = true;
      await host.group(false);
      if (wasRunning) await host.setRunning(true);
    }
  });

  el.stop.addEventListener('click', () => client.stop());
}
