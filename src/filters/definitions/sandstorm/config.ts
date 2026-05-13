import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'sandstorm',
  name:        'Sandstorm',
  description: 'Heavy horizontal sand streaks + dusty orange wash. Visibility tanks; the map fights through.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity', label: 'Streak Intensity',  min: 0,    max: 1,    step: 0.01, default: 0.7  },
    { type: 'slider', id: 'speed',     label: 'Wind Speed',        min: 0.1,  max: 5,    step: 0.05, default: 2.0  },
    { type: 'slider', id: 'density',   label: 'Density',           min: 0.05, max: 0.45, step: 0.01, default: 0.22 },
    { type: 'slider', id: 'wash',      label: 'Dust Wash',         min: 0,    max: 1,    step: 0.01, default: 0.6  },
  ],
};

export default definition;
