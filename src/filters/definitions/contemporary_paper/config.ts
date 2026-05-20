import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

/**
 * Contemporary Paper — modern notebook / printer / graph paper. Sibling
 * to Parchment Fantasy but pitched at present-day handouts: school /
 * scientific / casual hand-drawn maps. Five axes of variation per
 * Alex's v2.15 scope #4:
 *
 *   • colour / texture — base tint + grain
 *   • blank / lined / graphed (blue or black) — ruling style
 *   • clean / ink-blotted — splatter intensity
 *   • flat / crumpled — wrinkle / crease overlay
 *   • intact / torn — ragged edge framing
 *
 * No bundled paper texture file; the procedural fallback in
 * FilterRegistry gives a sensible neutral grain. A photographed
 * paper-grain texture can be dropped in later if higher fidelity is
 * wanted.
 */
const definition: FilterDefinition = {
  id: 'contemporary_paper',
  name: 'Contemporary Paper',
  description: 'Modern notebook / printer / graph paper — blank, lined, or grid; clean or inky; flat or crumpled.',
  vertexShader,
  fragmentShader,
  animated: false,
  groups: [
    { id: 'paper',     label: 'Paper'      },
    { id: 'ruling',    label: 'Ruling'     },
    { id: 'marks',     label: 'Ink & Marks'},
    { id: 'condition', label: 'Condition'  },
  ],
  params: [
    // Paper
    { type: 'color',  id: 'paperTint',     label: 'Paper Tint',         default: '#fbfaf4', group: 'paper' },
    { type: 'slider', id: 'tintStrength',  label: 'Tint Strength',      min: 0,    max: 1,    step: 0.01, default: 0.75, group: 'paper' },
    { type: 'slider', id: 'paperGrain',    label: 'Grain Intensity',    min: 0,    max: 1,    step: 0.01, default: 0.18, group: 'paper' },
    { type: 'slider', id: 'paperScale',    label: 'Grain Scale',        min: 0.5,  max: 8.0,  step: 0.5,  default: 3.0,  group: 'paper' },
    { type: 'slider', id: 'brightness',    label: 'Brightness',         min: 0.5,  max: 1.5,  step: 0.05, default: 1.0,  group: 'paper' },

    // Ruling — numeric select so the value injects as a float uniform.
    //   0 = blank          1 = lined (horizontal rules)
    //   2 = graph (blue)   3 = graph (black)
    { type: 'select', id: 'rulingStyle',   label: 'Ruling',
      options: [
        { value: 0, label: 'Blank' },
        { value: 1, label: 'Lined' },
        { value: 2, label: 'Graph — blue'  },
        { value: 3, label: 'Graph — black' },
      ],
      default: 0, group: 'ruling',
    },
    { type: 'slider', id: 'rulingSpacing', label: 'Line Spacing',       min: 12,   max: 80,   step: 1,    default: 28,   group: 'ruling' },
    { type: 'slider', id: 'rulingOpacity', label: 'Line Opacity',       min: 0,    max: 1,    step: 0.01, default: 0.4,  group: 'ruling' },

    // Marks
    { type: 'slider', id: 'inkBlots',      label: 'Ink Blots',          min: 0,    max: 1,    step: 0.01, default: 0.0,  group: 'marks' },
    { type: 'slider', id: 'smudge',        label: 'Smudge',             min: 0,    max: 1,    step: 0.01, default: 0.0,  group: 'marks' },

    // Condition
    { type: 'slider', id: 'crumple',       label: 'Crumple',            min: 0,    max: 1,    step: 0.01, default: 0.0,  group: 'condition' },
    { type: 'slider', id: 'torn',          label: 'Torn Edges',         min: 0,    max: 1,    step: 0.01, default: 0.0,  group: 'condition' },
  ],
};

export default definition;
