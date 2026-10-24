import { emptyCircuit } from './domain/circuit/circuit';
import { BoardRenderer } from './ui/canvas/board-renderer';
import { Editor, type Tool } from './ui/editor/editor';
import { LocalCircuitHost } from './ui/local-circuit-host';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const palette = document.querySelector<HTMLDivElement>('#palette')!;
const size = new URLSearchParams(location.search).get('size') === 'full' ? 'full' : 'half';

const host = new LocalCircuitHost(emptyCircuit(size));
let pointer: { x: number; y: number } | null = null;
let renderer: BoardRenderer | null = null;
let frame = 0;

const editor = new Editor(host, () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderer?.draw({
      circuit: editor.current,
      preview: editor.preview(),
      hover: editor.hover,
      pointer,
    });
    status.textContent = editor.message;
  });
});
renderer = new BoardRenderer(canvas, editor.current.spec);

palette.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
  if (!button) return;
  const kind = button.dataset['tool'];
  const tool: Tool =
    kind === 'part'
      ? { kind: 'part', type: button.dataset['type']! }
      : kind === 'wire'
        ? { kind: 'wire' }
        : { kind: 'select' };
  for (const b of palette.querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b === button));
  editor.setTool(tool);
});

const hit = (e: PointerEvent | MouseEvent) => renderer!.hitTest(e.clientX, e.clientY);

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  void editor.pointerDown(hit(e));
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
  if (e.key === 'Escape')
    (palette.querySelector('[data-tool="select"]') as HTMLButtonElement).click();
});
