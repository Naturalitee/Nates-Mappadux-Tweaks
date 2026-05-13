import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'candlelight',
  name:        'Candlelight Flicker',
  description: 'Warm radial pool of light at screen centre with organic flame flicker — for dungeon torch / single-candle scenes.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'warmth',   label: 'Warmth',        min: 0, max: 1, step: 0.01, default: 0.7  },
    { type: 'slider', id: 'reach',    label: 'Light Reach',   min: 0, max: 1, step: 0.01, default: 0.5  },
    { type: 'slider', id: 'darkness', label: 'Edge Darkness', min: 0, max: 1, step: 0.01, default: 0.65 },
    { type: 'slider', id: 'flicker',  label: 'Flicker',       min: 0, max: 1, step: 0.01, default: 0.5  },
  ],
};

export default definition;
