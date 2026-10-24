import { BoardRenderer } from './ui/canvas/board-renderer';
import { Editor, type Tool } from './ui/editor/editor';
import { WorkerCircuitHost } from './ui/worker-circuit-host';
import { HALF_ADDER } from './domain/demos/half-adder';
import type { PortLike } from './protocol/sim-protocol';

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

const editor = new Editor(host, () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderer?.draw({
      circuit: editor.current,
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
    }
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
          ? { kind: 'supply', supply: button.dataset['supply'] === 'ground' ? 'ground' : 'power' }
          : { kind: 'select' };
  for (const b of palette.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b === button));
  }
  editor.setTool(tool);
});

runToggle.addEventListener('click', () => void host.setRunning(!(editor.frame?.running ?? true)));
stepButton.addEventListener('click', () => void host.step(1));
document.querySelector('#clear-board')!.addEventListener('click', () => {
  void host.reset({ size, preset: 'bench' }).then(() => host.setRunning(true));
});
document.querySelector('#load-demo')!.addEventListener('click', async () => {
  await host.reset({ size, preset: 'bench' });
  for (const cmd of HALF_ADDER.commands) {
    const r = await host.apply(cmd);
    if (!r.ok) {
      editor.say(`Demo failed at ${cmd.op}: ${r.error.message}`);
      return;
    }
  }
  await host.setRunning(true);
  palette.querySelector<HTMLButtonElement>('[data-tool="select"]')!.click();
  editor.say(`${HALF_ADDER.title}: click SW1 (A) and SW2 (B). D1 = sum, D2 = carry.`);
});

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
