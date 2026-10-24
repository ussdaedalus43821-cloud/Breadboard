// The inspector: what the Select tool last clicked. Resistors get a value
// picker; LEDs, resistors and switches show their live electrical state.

import { CLOCK_PERIODS } from '../../domain/circuit/circuit';
import { SEGMENTS_FOR_DIGIT } from '../../domain/chips/sequential';
import { formatOhms, getPartDef, RESISTOR_VALUES } from '../../domain/parts/registry';
import type { SegmentState } from '../../domain/sim/solver';
import { terminalKey } from '../../domain/breadboard/terminal';
import type { Editor } from '../editor/editor';

export function mountInspector(root: HTMLElement, editor: Editor): () => void {
  const title = document.createElement('div');
  title.className = 'inspector-title';
  const detail = document.createElement('div');
  detail.className = 'inspector-detail';
  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value ';
  const value = document.createElement('select');
  value.id = 'inspector-ohms';
  value.setAttribute('aria-label', 'Resistance');
  for (const ohms of RESISTOR_VALUES) {
    const o = document.createElement('option');
    o.value = String(ohms);
    o.textContent = formatOhms(ohms);
    value.append(o);
  }
  valueLabel.append(value);
  const periodLabel = document.createElement('label');
  periodLabel.textContent = 'Frequency ';
  const period = document.createElement('select');
  period.id = 'inspector-period';
  period.setAttribute('aria-label', 'Clock frequency');
  for (const ticks of CLOCK_PERIODS) {
    const o = document.createElement('option');
    o.value = String(ticks);
    o.textContent = `${1000 / ticks} Hz (${ticks} ticks)`;
    period.append(o);
  }
  periodLabel.append(period);
  root.append(title, valueLabel, periodLabel, detail);
  value.addEventListener('change', () => void editor.setResistance(Number(value.value)));
  period.addEventListener('change', () => void editor.setPeriod(Number(period.value)));

  let shown = '';
  return function render(): void {
    const id = editor.selected;
    const part = id ? editor.current.parts.find((p) => p.id === id) : undefined;
    const lead = id ? editor.current.supplies.find((x) => x.id === id) : undefined;
    root.hidden = !part && !lead;
    if (lead) {
      title.textContent = `${lead.id} · ${lead.kind === 'clock' ? 'clock lead' : lead.kind === 'power' ? '+5 V lead' : 'ground lead'}`;
      valueLabel.hidden = true;
      periodLabel.hidden = lead.kind !== 'clock';
      const ticks = String(lead.periodTicks ?? '');
      if (lead.kind === 'clock' && shown !== `${id}:${ticks}`) period.value = ticks;
      shown = `${id}:${ticks}`;
      detail.textContent = `In ${terminalKey(lead.at)}${lead.kind === 'clock' ? ` · square wave 0/5 V, period ${ticks} ms` : ''}`;
      return;
    }
    if (!part) return;
    periodLabel.hidden = true;
    const def = getPartDef(part.type);
    const state = editor.frame?.parts[part.id] ?? {};
    title.textContent = `${part.id} · ${def.label}`;
    valueLabel.hidden = def.kind !== 'resistor';
    const ohms = String(def.props['ohms'] ?? '');
    // Do not fight the user while the menu is open: update only when it changed underneath.
    if (def.kind === 'resistor' && shown !== `${id}:${ohms}`) value.value = ohms;
    shown = `${id}:${ohms}`;
    const mA = (x: number | undefined) => (x === undefined ? '—' : `${Math.abs(x).toFixed(2)} mA`);
    detail.textContent =
      def.kind === 'led'
        ? state.burnt
          ? 'Burnt out. Remove it and place a new one.'
          : `${state.lit ? 'Lit' : 'Dark'} · ${mA(state.milliamps)} (rated ${def.props['maxMilliamps']} mA)`
        : def.kind === 'display'
          ? displayText(state.segments)
          : def.kind === 'resistor'
            ? `Current ${mA(state.milliamps)}`
            : def.kind === 'switch'
              ? `Position ${state.position ?? 0}${part.type === 'switch-spst' ? (state.position ? ' (closed)' : ' (open)') : ''} · click it to flip`
              : `${def.props['part'] ?? def.label} · ${def.pins.length} pins · pin 1 in ${terminalKey(part.pins['1']!)}`;
  };
}

/** What a 7-segment display reads as: a digit, blank, or its lit segments. */
export function displayText(segments: Readonly<Record<string, SegmentState>> | undefined): string {
  const lit = Object.entries(segments ?? {})
    .filter(([name, s]) => s.lit && name !== 'dp')
    .map(([name]) => name)
    .sort()
    .join('');
  const burnt = Object.entries(segments ?? {})
    .filter(([, s]) => s.burnt)
    .map(([name]) => name);
  const digit = SEGMENTS_FOR_DIGIT.findIndex((s) => [...s].sort().join('') === lit);
  const reads = lit === '' ? 'Blank' : digit >= 0 ? `Shows ${digit}` : `Segments ${lit} lit`;
  return burnt.length > 0 ? `${reads} · burnt: ${burnt.join(', ')}` : reads;
}
