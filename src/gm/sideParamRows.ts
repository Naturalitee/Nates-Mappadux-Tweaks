/**
 * Shared param-row builders for side-panel control surfaces.
 *
 * Canonical version of the colour / slider / toggle / select row elements
 * the GM side panels use. Lifted from GMApp's `_buildShader*` helpers
 * (originally written for Backdrop / MapFX shader params) so the same
 * markup, classes, label-column width, and tooltip behaviour apply to
 * every consumer: Backdrop, MapFX, Visual Filter (via FilterPanel),
 * Map Transition (via TransitionPanel), and anything that joins them.
 *
 * Each builder returns the row's root element. State stays with the
 * caller — these are pure DOM constructors with an onChange callback.
 *
 * Class names use the `fog-brush-row` family for historical reasons
 * (it's where the structure originated). Visual / semantic rename to
 * something like `side-panel-row` is banked for a follow-up sweep
 * but doesn't change behaviour today.
 */

import { wireSliderTooltip } from '../utils/sliderReadout.ts';

export interface ColorRowOpts {
  label: string;
  value: string;
  /** Optional tooltip text on the colour input (hover-revealable
   *  context like "Colour — Aurora"). */
  title?: string;
}

export function buildColorRow(opts: ColorRowOpts, onChange: (hex: string) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'fog-brush-row fog-brush-row--color';
  const labelEl = document.createElement('span');
  labelEl.textContent = opts.label;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = opts.value;
  if (opts.title) input.title = opts.title;
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(labelEl);
  row.appendChild(input);
  return row;
}

export interface SliderRowOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Optional tooltip text on the slider (hover-revealable current
   *  value via wireSliderTooltip). */
  title?: string;
}

export function buildSliderRow(opts: SliderRowOpts, onChange: (v: number) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'fog-brush-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = opts.label;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.value);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (!Number.isFinite(v)) return;
    onChange(v);
  });
  // Hover-revealable current value — no permanent UI footprint.
  wireSliderTooltip(slider, opts.title ?? opts.label);
  row.appendChild(labelEl);
  row.appendChild(slider);
  return row;
}

export interface ToggleRowOpts {
  label: string;
  checked: boolean;
  /** Optional tooltip text on the toggle (hover-revealable context). */
  title?: string;
}

export function buildToggleRow(opts: ToggleRowOpts, onChange: (checked: boolean) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fog-brush-row fog-brush-row--toggle';
  const labelEl = document.createElement('span');
  labelEl.textContent = opts.label;
  const switchLabel = document.createElement('label');
  switchLabel.className = 'toggle-switch';
  if (opts.title) switchLabel.title = opts.title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = opts.checked;
  const knob = document.createElement('span');
  knob.className = 'toggle-slider';
  switchLabel.appendChild(input);
  switchLabel.appendChild(knob);
  input.addEventListener('change', () => onChange(input.checked));
  row.appendChild(labelEl);
  row.appendChild(switchLabel);
  return row;
}

export interface SelectRowOpts {
  label: string;
  options: ReadonlyArray<{ value: string | number; label: string }>;
  value: string | number;
  /** Optional tooltip text on the select element. */
  title?: string;
}

export function buildSelectRow(
  opts: SelectRowOpts,
  onChange: (v: string | number) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'fog-brush-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = opts.label;
  const select = document.createElement('select');
  if (opts.title) select.title = opts.title;
  for (const opt of opts.options) {
    const option = document.createElement('option');
    option.value = String(opt.value);
    option.textContent = opt.label;
    if (opt.value === opts.value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const raw = select.value;
    const numeric = parseFloat(raw);
    onChange(Number.isNaN(numeric) ? raw : numeric);
  });
  row.appendChild(labelEl);
  row.appendChild(select);
  return row;
}
