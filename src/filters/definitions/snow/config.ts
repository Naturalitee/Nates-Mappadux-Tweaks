import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'snow',
  name:        'Snow',
  description: 'Top-down snow — flakes blowing across the surface with wind direction + speed. For battlemaps. Side-view variant: "Snow (Side-View)".',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity', label: 'Intensity',  min: 0,    max: 1,    step: 0.01, default: 0.75 },
    { type: 'slider', id: 'density',   label: 'Density',    min: 0.01, max: 0.50, step: 0.01, default: 0.22 },
    { type: 'slider', id: 'windSpeed', label: 'Wind Speed', min: 0,    max: 4,    step: 0.05, default: 0.8  },
    { type: 'slider', id: 'windAngle', label: 'Wind Angle (0-1 = 360°)', min: 0, max: 1, step: 0.01, default: 0.0 },
    { type: 'slider', id: 'gusts',     label: 'Gusts',      min: 0,    max: 2,    step: 0.05, default: 0.6  },
    { type: 'slider', id: 'coolTint',  label: 'Cool Tint',  min: 0,    max: 1,    step: 0.01, default: 0.35 },
  ],
};

export default definition;
