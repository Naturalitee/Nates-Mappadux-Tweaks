import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'time_loop',
  name:        'Time-Loop Ghosting',
  description: 'Colour channels orbit around the current frame + slow scale breathe + skip-flicker. Déjà vu, temporal slippage, Groundhog Day.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'ghost',   label: 'Echo Strength', min: 0, max: 1.5, step: 0.05, default: 0.7  },
    { type: 'slider', id: 'speed',   label: 'Echo Speed',    min: 0.1, max: 3, step: 0.05, default: 1.0  },
    { type: 'slider', id: 'breathe', label: 'Scale Breathe', min: 0, max: 2,   step: 0.05, default: 0.7  },
    { type: 'slider', id: 'flicker', label: 'Skip Flicker',  min: 0, max: 1,   step: 0.01, default: 0.35 },
  ],
};

export default definition;
