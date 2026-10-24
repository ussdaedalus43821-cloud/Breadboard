import { BoardRenderer } from './ui/canvas/board-renderer';
import { ZOOM_STEP, fitView, panBy, wheelFactor, zoomAt } from './ui/canvas/viewport';
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
import { mountWelcome } from './ui/panels/welcome';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const viewportEl = document.querySelector<HTMLDivElement>('#board-viewport')!;
const zoomLabel = document.querySelector<HTMLSpanElement>('#zoom-level')!;
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

const viewportSize = () => ({ w: viewportEl.clientWidth, h: viewportEl.clientHeight });
/** A renderer for the current board, fitted to the viewport. */
function makeRenderer(): BoardRenderer {
  const r = new BoardRenderer(canvas, editor.current.spec, viewportSize());
  r.view = fitView(r.boardSize, r.viewportSize);
  fitted = true;
  return r;
}
/** True until the user zooms or pans: a fitted view refits when the window resizes. */
let fitted = true;

const editor = new Editor(host, requestDraw);
function requestDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    // A loaded save may use the other board size.
    if (renderer && renderer.spec.size !== editor.current.spec.size) renderer = makeRenderer();
    if (renderer) {
      const zoom = Math.round(renderer.view.zoom * 100);
      zoomLabel.textContent = `${zoom}%`;
      canvas.dataset['zoom'] = renderer.view.zoom.toFixed(3);
      canvas.dataset['view'] = `${renderer.view.x.toFixed(1)},${renderer.view.y.toFixed(1)}`;
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
}
renderer = makeRenderer();
new ResizeObserver(() => {
  if (!renderer) return;
  renderer.resize(viewportSize());
  if (fitted) renderer.view = fitView(renderer.boardSize, renderer.viewportSize);
  requestDraw();
}).observe(viewportEl);
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
async function loadDemo(key: string): Promise<void> {
  const demo = DEMOS[key];
  if (!demo) return;
  document.querySelector<HTMLSelectElement>('#demo-list')!.value = key;
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
  const clocked = demo.commands.some((c) => c.op === 'clock');
  editor.say(
    clocked
      ? `${demo.title}. Select ${Object.values(demo.inputs).join(', ')} to change its frequency; watch ${outs}.`
      : `${demo.title}. Click the switches (${ins}); watch ${outs}.`,
  );
}
document
  .querySelector('#load-demo')!
  .addEventListener('click', () =>
    loadDemo(document.querySelector<HTMLSelectElement>('#demo-list')!.value),
  );

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

// ---- Zoom and pan: wheel zooms around the cursor; middle-drag or Space+drag pans.

let pan: { id: number; x: number; y: number } | null = null;
let spaceHeld = false;
let overBoard = false;
const setView = (f: (r: BoardRenderer) => BoardRenderer['view'], fit = false): void => {
  renderer!.view = f(renderer!);
  fitted = fit;
  requestDraw();
};
const updateCursor = (): void => {
  canvas.style.cursor = pan ? 'grabbing' : spaceHeld ? 'grab' : '';
};
const zoomCentre = (factor: number) =>
  setView((r) => zoomAt(r.view, factor, { x: r.viewportSize.w / 2, y: r.viewportSize.h / 2 }));

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const at = renderer!.screenPoint(e.clientX, e.clientY);
    setView((r) => zoomAt(r.view, wheelFactor(e.deltaY, e.deltaMode), at));
  },
  { passive: false },
);
// No middle-button autoscroll or paste on the board.
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});
canvas.addEventListener('auxclick', (e) => e.preventDefault());
document.querySelector('#zoom-in')!.addEventListener('click', () => zoomCentre(ZOOM_STEP));
document.querySelector('#zoom-out')!.addEventListener('click', () => zoomCentre(1 / ZOOM_STEP));
document
  .querySelector('#zoom-fit')!
  .addEventListener('click', () => setView((r) => fitView(r.boardSize, r.viewportSize), true));
viewportEl.addEventListener('pointerenter', () => (overBoard = true));
viewportEl.addEventListener('pointerleave', () => (overBoard = false));
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !overBoard) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  // Space over the board means pan, not "press the focused button".
  if (t?.tagName === 'BUTTON') t.blur();
  e.preventDefault();
  if (!spaceHeld) {
    spaceHeld = true;
    updateCursor();
  }
});
const releaseSpace = (): void => {
  spaceHeld = false;
  updateCursor();
};
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') releaseSpace();
});
window.addEventListener('blur', releaseSpace);

const hit = (e: PointerEvent | MouseEvent) => renderer!.hitTest(e.clientX, e.clientY);
const pitchPoint = (e: PointerEvent | MouseEvent) =>
  renderer!.layout.toPitch(renderer!.localPoint(e.clientX, e.clientY));

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    updateCursor();
    return;
  }
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  void editor.pointerDown(hit(e), pitchPoint(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (pan && e.pointerId === pan.id) {
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    pan = { ...pan, x: e.clientX, y: e.clientY };
    setView((r) => panBy(r.view, dx, dy));
    return;
  }
  pointer = renderer!.localPoint(e.clientX, e.clientY);
  editor.pointerMove(hit(e));
});
canvas.addEventListener('pointerup', (e) => {
  if (pan && e.pointerId === pan.id) {
    pan = null;
    updateCursor();
    return;
  }
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
  } else if (!mod && !e.altKey && (e.key === '+' || e.key === '=')) {
    zoomCentre(ZOOM_STEP);
  } else if (!mod && !e.altKey && e.key === '-') {
    zoomCentre(1 / ZOOM_STEP);
  } else if (!mod && !e.altKey && e.key === '0') {
    setView((r) => fitView(r.boardSize, r.viewportSize), true);
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
mountWelcome(
  document.querySelector<HTMLDialogElement>('#welcome')!,
  document.querySelector<HTMLButtonElement>('#help')!,
  { loadDemo, suppress: location.hash.length > 1 },
);
window.addEventListener('hashchange', () => void openSharedLink());
