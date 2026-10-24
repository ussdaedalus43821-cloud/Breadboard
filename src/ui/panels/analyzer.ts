// The logic analyzer: the last 50 ticks at up to 4 probed wires. Click a wire
// with the Select tool to add or remove it. The sim worker records every tick;
// this only draws the frame's trace.

import type { Level } from '../../domain/sim/levels';
import type { TraceFrame } from '../../protocol/sim-protocol';
import { PROBE_COLORS } from '../canvas/board-renderer';
import type { Editor } from '../editor/editor';

const ROW = 34;
const LABEL = 86;
const TICKS = 50;

const symbol = (l: Level): string => (l === 0 || l === 1 ? String(l) : l);

export function mountAnalyzer(root: HTMLDetailsElement, editor: Editor): () => void {
  const summary = root.querySelector('summary')!;
  const canvas = document.createElement('canvas');
  canvas.id = 'analyzer-canvas';
  const hint = document.createElement('p');
  hint.className = 'analyzer-hint';
  hint.textContent =
    'Select tool: click a wire to add it here (up to 4). Click it again to remove it.';
  root.append(hint, canvas);
  const ctx = canvas.getContext('2d')!;
  let drawn = '';

  return function render(): void {
    const trace: TraceFrame | undefined = editor.frame?.trace;
    const probes = editor.probes;
    summary.textContent = `Logic analyzer (${probes.length}/4)`;
    hint.hidden = probes.length > 0;
    canvas.hidden = probes.length === 0;
    if (!root.open || probes.length === 0 || !trace) return;

    const key = JSON.stringify([trace, probes]);
    if (key === drawn) return;
    drawn = key;

    const width = Math.max(320, Math.min(root.clientWidth - 24, 900));
    const height = probes.length * ROW + 22;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#18191c';
    ctx.fillRect(0, 0, width, height);

    const plotW = width - LABEL - 8;
    const step = plotW / TICKS;
    const last = trace.ticks.at(-1) ?? 0;
    // Right-aligned: the newest tick is at the right edge.
    const xOf = (i: number) => LABEL + (TICKS - trace.ticks.length + i) * step;

    // Tick grid every 10 ticks.
    ctx.strokeStyle = '#2c2e33';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6c717a';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let t = last - (last % 10); t > last - TICKS; t -= 10) {
      const x = LABEL + (TICKS - 1 - (last - t)) * step + step;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - 14);
      ctx.stroke();
      ctx.fillText(`${t}`, x, height - 4);
    }

    const samples: string[] = [];
    probes.forEach((wireId, p) => {
      const levels = trace.levels[p] ?? [];
      samples.push(levels.map(symbol).join(''));
      const yTop = p * ROW + 8;
      const yHigh = yTop + 4;
      const yLow = yTop + ROW - 12;
      const yMid = (yHigh + yLow) / 2;
      const color = PROBE_COLORS[p % PROBE_COLORS.length]!;

      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillText(`${p + 1} ${wireId}`, 8, yMid - 2);
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#9aa0a6';
      ctx.fillText(`now ${symbol(levels.at(-1) ?? 'Z')}`, 8, yMid + 11);

      ctx.lineWidth = 2;
      let prevY: number | null = null;
      levels.forEach((l, i) => {
        const x = xOf(i);
        if (l === 'X') {
          ctx.fillStyle = 'rgba(250, 82, 82, 0.35)';
          ctx.fillRect(x, yHigh, step, yLow - yHigh);
          prevY = null;
          return;
        }
        const y = l === 1 ? yHigh : l === 0 ? yLow : yMid;
        ctx.strokeStyle = color;
        ctx.setLineDash(l === 'Z' ? [3, 3] : []);
        ctx.beginPath();
        if (prevY !== null && prevY !== y) {
          ctx.moveTo(x, prevY); // the edge
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
        }
        ctx.lineTo(x + step, y);
        ctx.stroke();
        prevY = y;
      });
      ctx.setLineDash([]);
    });
    // The plotted samples, oldest first, one string per channel: for tests and screen readers.
    canvas.dataset['samples'] = samples.join(',');
    canvas.setAttribute('aria-label', probes.map((id, p) => `${id}: ${samples[p]}`).join('; '));
  };
}
