import type { FilterDefinition, FilterParam } from './schema.ts';
import type { FilterParamValues } from '../types.ts';
import {
  buildColorRow,
  buildSliderRow,
  buildToggleRow,
  buildSelectRow,
} from '../gm/sideParamRows.ts';

/**
 * FilterPanel
 *
 * Auto-generates a DOM control panel from a FilterDefinition.
 * v2.16.39 — rebuilt on top of the shared sideParamRows builders so the
 * look matches Backdrop / MapFX / Map Transition exactly. Param groups
 * (collapsible sections) are unique to filters and stay here.
 *
 * Caller provides a container element and a change callback. The panel
 * tags every control's input with `data-param-id` so `setValues()` can
 * push fresh values in without rebuilding the DOM (used during live
 * state syncs).
 */
export class FilterPanel {
  private container: HTMLElement;
  private onChangeCallback: (values: FilterParamValues) => void;
  private currentValues: FilterParamValues = {};

  constructor(
    container: HTMLElement,
    onChange: (values: FilterParamValues) => void
  ) {
    this.container = container;
    this.onChangeCallback = onChange;
  }

  /** Renders controls for the given filter, pre-populated with saved values */
  render(filter: FilterDefinition, savedValues: FilterParamValues): void {
    this.container.innerHTML = '';
    this.currentValues = { ...savedValues };

    if (filter.params.length === 0) {
      this.container.innerHTML = '<p class="filter-empty">No parameters for this filter.</p>';
      return;
    }

    const groups = this.buildGroups(filter);

    for (const [groupId, params] of groups) {
      const groupDef = filter.groups?.find((g) => g.id === groupId);
      const wrapper = this.buildGroupWrapper(groupId, groupDef?.label ?? groupId, groupDef?.collapsed ?? true);
      const body = wrapper.querySelector('.filter-group-body') as HTMLElement;

      for (const param of params) {
        body.appendChild(this.buildControl(param, filter.name));
      }

      this.container.appendChild(wrapper);
    }
  }

  /** Updates control values without re-rendering (e.g. on remote state sync) */
  setValues(values: FilterParamValues): void {
    this.currentValues = { ...values };
    for (const [id, value] of Object.entries(values)) {
      const el = this.container.querySelector(`[data-param-id="${id}"]`) as HTMLInputElement | null;
      if (!el) continue;
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        el.value = String(value);
      }
    }
  }

  getCurrentValues(): FilterParamValues {
    return { ...this.currentValues };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildGroups(filter: FilterDefinition): Map<string, FilterParam[]> {
    const groups = new Map<string, FilterParam[]>();
    const ungroupedKey = '__ungrouped__';

    for (const param of filter.params) {
      const key = param.group ?? ungroupedKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(param);
    }

    // Move ungrouped to front
    if (groups.has(ungroupedKey)) {
      const ungrouped = groups.get(ungroupedKey)!;
      groups.delete(ungroupedKey);
      const ordered = new Map([[ungroupedKey, ungrouped], ...groups]);
      return ordered;
    }

    return groups;
  }

  private buildGroupWrapper(id: string, label: string, collapsed: boolean): HTMLElement {
    const section = document.createElement('section');
    section.className = 'filter-group';

    if (id === '__ungrouped__') {
      const body = document.createElement('div');
      body.className = 'filter-group-body';
      section.appendChild(body);
      return section;
    }

    const header = document.createElement('button');
    header.className = 'filter-group-header';
    header.setAttribute('aria-expanded', String(!collapsed));
    header.textContent = label;
    header.addEventListener('click', () => {
      const expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });

    const body = document.createElement('div');
    body.className = 'filter-group-body';
    body.hidden = collapsed;

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  /** Build one control row using the shared sideParamRows builders + tag
   *  its input with data-param-id so setValues() can push fresh values
   *  in without rebuilding the row. */
  private buildControl(param: FilterParam, filterName: string): HTMLElement {
    const title = `${param.label} — ${filterName}`;
    let row: HTMLElement;
    switch (param.type) {
      case 'slider': {
        const value = (this.currentValues[param.id] as number) ?? param.default;
        row = buildSliderRow(
          { label: param.label, min: param.min, max: param.max, step: param.step, value, title },
          (v) => {
            this.currentValues[param.id] = v;
            this.onChangeCallback({ ...this.currentValues });
          },
        );
        break;
      }
      case 'toggle': {
        const value = (this.currentValues[param.id] as boolean) ?? param.default;
        row = buildToggleRow(
          { label: param.label, checked: value, title },
          (checked) => {
            this.currentValues[param.id] = checked;
            this.onChangeCallback({ ...this.currentValues });
          },
        );
        break;
      }
      case 'color': {
        const value = (this.currentValues[param.id] as string) ?? param.default;
        row = buildColorRow(
          { label: param.label, value, title },
          (hex) => {
            this.currentValues[param.id] = hex;
            this.onChangeCallback({ ...this.currentValues });
          },
        );
        break;
      }
      case 'select': {
        const value = (this.currentValues[param.id] as string | number) ?? param.default;
        row = buildSelectRow(
          { label: param.label, options: param.options, value, title },
          (v) => {
            this.currentValues[param.id] = v;
            this.onChangeCallback({ ...this.currentValues });
          },
        );
        break;
      }
    }
    // Tag the row's input so setValues() can find it.
    const input = row.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    if (input) input.dataset['paramId'] = param.id;
    return row;
  }
}
