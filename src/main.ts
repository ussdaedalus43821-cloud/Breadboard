import { boardSpec } from './domain/breadboard/spec';
import { terminalKey } from './domain/breadboard/terminal';
import { BoardRenderer } from './ui/canvas/board-renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const size = new URLSearchParams(location.search).get('size') === 'full' ? 'full' : 'half';

const renderer = new BoardRenderer(canvas, boardSpec(size));
renderer.draw();

canvas.addEventListener('click', (e) => {
  const ref = renderer.hitTest(e.clientX, e.clientY);
  renderer.select(ref);
  status.textContent = ref ? terminalKey(ref) : 'No hole there.';
});
