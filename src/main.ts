import { BoardRenderer } from './ui/canvas/board-renderer';
import { Editor, type Tool } from './ui/editor/editor';
import { WorkerCircuitHost } from './ui/worker-circuit-host';
import { DEMOS } from './domain/demos';
import { mountAnalyzer } from './ui/panels/analyzer';
import type { PortLike } from './protocol/sim-protocol';
import { NovaClient } from './ui/nova-client';
import { mountScriptingPanel } from './ui/panels/scripting-panel';
import { mountInspector } from './ui/panels/inspector';
import { toSave } from './domain/circuit/save';
import { decodeShareHash, encodeShareHash } from './ui/persistence/share';
import { deleteSave, listSaves, readSave, writeSave } from './ui/persistence/storage';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const hoverLine = document.querySelector<HTMLDivElement>('#hover')!;
const warningList = document.querySelector<HTMLUListElement>('#warnings')!;
const palette = document.querySelector<HTMLDivElement>('#palette')!;
const runToggle = document.querySelector<HTMLButtonElement>('#run-toggle')!;
const stepButton = document.querySelector<HTMLButtonElement>('#step-1')!;
const clock = document.querySelector<HTMLSpanElement>('#clock')!;
const size = new URLSearchParams(location.search).get('size') === 'full' ? 'full' : 'half';

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const host = new WorkerCircuitHost(worker as unknown as PortLike, { size, preset: 'bench' });
await host.ready;
await host.setRunning(true);

let pointer: { x: number; y: number } | null = null;
let renderer: BoardRenderer | null = null;
let frame = 0;
let shownWarnings = '';
let renderInspector: () => void = () => {};
let renderAnalyzer: () => void = () => {};
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!;
const redoButton = document.querySelector<HTMLButtonElement>('#redo')!;

const editor = new Editor(host, () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    // A loaded save may use the other board size.
    if (renderer && renderer.spec.size !== editor.current.spec.size) {
      renderer = new BoardRenderer(canvas, editor.current.spec);
    }
    renderer?.draw({
      circuit: editor.current,
      selected: editor.selected,
      probes: editor.probes,
      frame: editor.frame,
      preview: editor.preview(),
      hover: editor.hover,
      pointer,
    });
    status.textContent = editor.message;
    const f = editor.frame;
    if (f) {
      clock.textContent = `t = ${f.time.ms} ms`;
      runToggle.textContent = f.running ? 'Pause' : 'Run';
      stepButton.disabled = f.running;
      undoButton.disabled = !f.history.canUndo;
      redoButton.disabled = !f.history.canRedo;
      undoButton.title = f.history.undoLabel ? `Undo ${f.history.undoLabel} (Ctrl+Z)` : 'Ctrl+Z';
      redoButton.title = f.history.redoLabel ? `Redo ${f.history.redoLabel} (Ctrl+Y)` : 'Ctrl+Y';
    }
    renderInspector();
    renderAnalyzer();
    hoverLine.textContent = editor.hoverInfo();
    const warnings = editor.frame?.warnings ?? [];
    const text = warnings.map((w) => `${w.code}: ${w.message}`).join('\n');
    if (text !== shownWarnings) {
      shownWarnings = text;
      warningList.replaceChildren(
        ...warnings.map((w) => {
          const li = document.createElement('li');
          li.textContent = `${w.code}: ${w.message}`;
          return li;
        }),
      );
    }
  });
});
renderer = new BoardRenderer(canvas, editor.current.spec);
editor.setTool({ kind: 'select' });

palette.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
  if (!button) return;
  const kind = button.dataset['tool'];
  const tool: Tool =
    kind === 'part'
      ? { kind: 'part', type: button.dataset['type']! }
      : kind === 'wire'
        ? { kind: 'wire' }
        : kind === 'supply'
          ? {
              kind: 'supply',
              supply:
                button.dataset['supply'] === 'ground'
                  ? 'ground'
                  : button.dataset['supply'] === 'clock'
                    ? 'clock'
                    : 'power',
            }
          : { kind: 'select' };
  for (const b of palette.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b === button));
  }
  editor.setTool(tool);
});

runToggle.addEventListener('click', () => void host.setRunning(!(editor.frame?.running ?? true)));
stepButton.addEventListener('click', () => void host.step(1));
document.querySelector('#clear-board')!.addEventListener('click', () => {
  void host
    .clear({ size, preset: 'bench' })
    .then(() => editor.say('Cleared. Ctrl+Z brings it back.'));
});
document.querySelector('#load-demo')!.addEventListener('click', async () => {
  const demo = DEMOS[document.querySelector<HTMLSelectElement>('#demo-list')!.value]!;
  await host.group(true, 'load demo'); // the whole demo undoes as one step
  try {
    await host.clear({ size: demo.size ?? size, preset: 'bench' });
    for (const cmd of demo.commands) {
      const r = await host.apply(cmd);
      if (!r.ok) {
        editor.say(`Demo failed at ${cmd.op}: ${r.error.message}`);
        return;
      }
    }
  } finally {
    await host.group(false);
  }
  palette.querySelector<HTMLButtonElement>('[data-tool="select"]')!.click();
  const ins = Object.entries(demo.inputs)
    .map(([name, id]) => `${id} = ${name}`)
    .join(', ');
  const outs = Object.entries(demo.outputs)
    .map(([name, id]) => `${id} = ${name}`)
    .join(', ');
  editor.say(`${demo.title}. Click the switches (${ins}); watch ${outs}.`);
});

// NovaLang scripting: the nova worker starts the first time the panel opens.
const base = import.meta.env.BASE_URL;
const nova = new NovaClient(
  () => new Worker(new URL('./nova/worker.ts', import.meta.url), { type: 'module' }),
  (port, message) => worker.postMessage(message, [port]),
  base,
);
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
mountScriptingPanel(
  {
    toggle: $('#scripting-toggle'),
    panel: $('#scripting'),
    example: $('#script-example'),
    source: $('#script-source'),
    run: $('#script-run'),
    stop: $('#script-stop'),
    timeout: $('#script-timeout'),
    status: $('#script-status'),
    output: $('#script-output'),
  },
  nova,
  host,
  () => editor.frame?.running ?? true,
  base,
);

const hit = (e: PointerEvent | MouseEvent) => renderer!.hitTest(e.clientX, e.clientY);
const pitchPoint = (e: PointerEvent | MouseEvent) =>
  renderer!.layout.toPitch(renderer!.localPoint(e.clientX, e.clientY));

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  void editor.pointerDown(hit(e), pitchPoint(e));
});
canvas.addEventListener('pointermove', (e) => {
  pointer = renderer!.localPoint(e.clientX, e.clientY);
  editor.pointerMove(hit(e));
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  void editor.pointerUp(hit(e));
});
canvas.addEventListener('pointerleave', () => {
  pointer = null;
  editor.pointerMove(null);
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  void editor.removeAt(hit(e));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    palette.querySelector<HTMLButtonElement>('[data-tool="select"]')!.click();
  }
});

// ---- Undo / redo -------------------------------------------------------------

const undo = async (): Promise<void> => {
  const r = await host.undo();
  editor.say(r.ok ? `Undid ${r.id}.` : r.error.message);
};
const redo = async (): Promise<void> => {
  const r = await host.redo();
  editor.say(r.ok ? `Redid ${r.id}.` : r.error.message);
};
undoButton.addEventListener('click', () => void undo());
redoButton.addEventListener('click', () => void redo());
window.addEventListener('keydown', (e) => {
  // Text fields (the script editor) keep their own undo.
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z' && !e.shiftKey) {
    e.preventDefault();
    void undo();
  } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
    e.preventDefault();
    void redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selected) {
    e.preventDefault();
    void editor.removeSelected();
  }
});

// ---- Inspector -----------------------------------------------------------------

renderInspector = mountInspector(document.querySelector<HTMLElement>('#inspector')!, editor);
renderAnalyzer = mountAnalyzer(document.querySelector<HTMLDetailsElement>('#analyzer')!, editor);
document.querySelector('#analyzer')!.addEventListener('toggle', () => renderAnalyzer());

// ---- Save / load / share ---------------------------------------------------

const saveName = document.querySelector<HTMLInputElement>('#save-name')!;
const savedList = document.querySelector<HTMLSelectElement>('#saved-list')!;
const shareUrl = document.querySelector<HTMLInputElement>('#share-url')!;

function refreshSaves(select?: string): void {
  const saves = listSaves();
  savedList.replaceChildren(
    ...saves.map((s) => {
      const o = document.createElement('option');
      o.value = s.name;
      o.textContent = s.name;
      return o;
    }),
  );
  if (saves.length === 0) {
    const o = document.createElement('option');
    o.textContent = '(no saved circuits)';
    o.value = '';
    savedList.append(o);
  }
  if (select) savedList.value = select;
}
refreshSaves();

async function loadSave(save: unknown, what: string): Promise<void> {
  const r = await host.load(save);
  editor.say(
    r.ok ? `Loaded ${what}. Ctrl+Z goes back.` : `Could not load ${what}: ${r.error.message}`,
  );
}

document.querySelector('#save')!.addEventListener('click', () => {
  const name = saveName.value.trim() || 'My circuit';
  const error = writeSave(
    name,
    toSave(editor.current, { title: name, created: new Date().toISOString() }),
  );
  editor.say(error ?? `Saved "${name}" in this browser.`);
  refreshSaves(name);
});
document.querySelector('#load')!.addEventListener('click', () => {
  const name = savedList.value;
  if (!name) return;
  const save = readSave(name);
  if (save === null) {
    editor.say(`"${name}" could not be read.`);
    return;
  }
  saveName.value = name;
  void loadSave(save, `"${name}"`);
});
document.querySelector('#delete-save')!.addEventListener('click', () => {
  const name = savedList.value;
  if (!name) return;
  deleteSave(name);
  refreshSaves();
  editor.say(`Deleted "${name}".`);
});
document.querySelector('#export-url')!.addEventListener('click', async () => {
  const hash = await encodeShareHash(toSave(editor.current, { created: new Date().toISOString() }));
  history.replaceState(null, '', hash);
  shareUrl.value = location.href;
  shareUrl.hidden = false;
  shareUrl.select();
  try {
    await navigator.clipboard.writeText(location.href);
    editor.say(
      `Link copied (${location.href.length} characters). Anyone who opens it gets this circuit.`,
    );
  } catch {
    editor.say('Link ready: copy it from the box.');
  }
});

// A shared link opens its circuit.
async function openSharedLink(): Promise<void> {
  try {
    const save = await decodeShareHash(location.hash);
    if (save !== null) await loadSave(save, 'the shared circuit');
  } catch (e) {
    editor.say(e instanceof Error ? e.message : String(e));
  }
}
void openSharedLink();
window.addEventListener('hashchange', () => void openSharedLink());
