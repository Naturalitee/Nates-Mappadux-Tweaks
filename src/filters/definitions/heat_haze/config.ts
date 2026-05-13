import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'heat_haze',
  name:        'Heat Haze',
  description: 'Top-down heat shimmer — patches of warm-air distortion drift across the whole surface + warm wash on highlights. For battlemaps. Side-view variant: "Heat Haze (Side-View)".',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'shimmer',    label: 'Shimmer',    min: 0,   max: 3,    step: 0.05, default: 1.2 },
    { type: 'slider', id: 'speed',      label: 'Speed',      min: 0.1, max: 3,    step: 0.05, default: 1.0 },
    { type: 'slider', id: 'patchiness', label: 'Patchiness', min: 0,   max: 1,    step: 0.01, default: 0.5 },
    { type: 'slider', id: 'warmth',     label: 'Warmth',     min: 0,   max: 1,    step: 0.01, default: 0.55 },
  ],
};

export default definition;
