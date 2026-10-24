// The inspector: what the Select tool last clicked. Resistors get a value
// picker; LEDs, resistors and switches show their live electrical state.

import { formatOhms, getPartDef, RESISTOR_VALUES } from '../../domain/parts/registry';
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
  root.append(title, valueLabel, detail);
  value.addEventListener('change', () => void editor.setResistance(Number(value.value)));

  let shown = '';
  return function render(): void {
    const id = editor.selected;
    const part = id ? editor.current.parts.find((p) => p.id === id) : undefined;
    root.hidden = !part;
    if (!part) return;
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
        : def.kind === 'resistor'
          ? `Current ${mA(state.milliamps)}`
          : def.kind === 'switch'
            ? `Position ${state.position ?? 0}${part.type === 'switch-spst' ? (state.position ? ' (closed)' : ' (open)') : ''} · click it to flip`
            : `${def.props['part'] ?? def.label} · ${def.pins.length} pins · pin 1 in ${terminalKey(part.pins['1']!)}`;
  };
}
