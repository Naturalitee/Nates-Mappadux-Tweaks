import type { TransitionDefinition, TransitionParam } from './schema.ts';
import {
  buildColorRow,
  buildSliderRow,
  buildSelectRow,
} from '../gm/sideParamRows.ts';

/**
 * TransitionPanel
 *
 * Renders parameter controls (sliders + selects + colour swatches) for the
 * currently selected transition definition. v2.16.39 — rebuilt on top of
 * the shared sideParamRows builders so the look matches Backdrop / MapFX /
 * Visual Filter exactly. No more bespoke `param-row--stacked` markup.
 */
export class TransitionPanel {
  private container: HTMLElement;
  private onChangeFn: (params: Record<string, number | string>) => void;
  private currentParams: Record<string, number | string> = {};

  constructor(
    container: HTMLElement,
    onChange: (params: Record<string, number | string>) => void,
  ) {
    this.container = container;
    this.onChangeFn = onChange;
  }

  /** Rebuild the controls for the given transition, pre-populated with saved values. */
  render(def: TransitionDefinition, savedParams: Record<string, number | string>): void {
    this.container.innerHTML = '';
    this.currentParams = { ...savedParams };

    if (def.id === 'none' || def.params.length === 0) {
      this.container.hidden = true;
      return;
    }

    this.container.hidden = false;
    for (const param of def.params) {
      this.container.appendChild(this.buildControl(param, def.label));
    }
  }

  getParams(): Record<string, number | string> {
    return { ...this.currentParams };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildControl(param: TransitionParam, kindLabel: string): HTMLElement {
    switch (param.type) {
      case 'slider': {
        const label = param.unit ? `${param.label} (${param.unit})` : param.label;
        const value = (this.currentParams[param.id] as number) ?? param.default;
        return buildSliderRow(
          { label, min: param.min, max: param.max, step: param.step, value, title: `${label} — ${kindLabel}` },
          (v) => {
            this.currentParams[param.id] = v;
            this.onChangeFn({ ...this.currentParams });
          },
        );
      }
      case 'select': {
        const value = (this.currentParams[param.id] as string) ?? param.default;
        return buildSelectRow(
          { label: param.label, options: param.options, value, title: `${param.label} — ${kindLabel}` },
          (v) => {
            this.currentParams[param.id] = String(v);
            this.onChangeFn({ ...this.currentParams });
          },
        );
      }
      case 'color': {
        const value = (this.currentParams[param.id] as string) ?? param.default;
        return buildColorRow(
          { label: param.label, value, title: `${param.label} — ${kindLabel}` },
          (hex) => {
            this.currentParams[param.id] = hex;
            this.onChangeFn({ ...this.currentParams });
          },
        );
      }
    }
  }
}
