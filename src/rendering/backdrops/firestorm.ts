/**
 * Firestorm backdrop — derived from the MapFX 'firestorm' kind. One
 * source (src/mapfx/shaders/firestorm/fragment.glsl) drives both
 * subsystems via the backdrop wrapper.
 *
 * Adapted from PrzemyslawZaworski's "GPU hacks #07 - DirectX 12" —
 * see ACKNOWLEDGEMENTS.md. The wrapper picks an alpha-composite
 * over uBgColor (because the kind's blend mode is 'normal'), giving
 * the volumetric smoke columns their "obscure the bg" reading
 * rather than the additive look the other ambient effects use.
 *
 * Heaviest shader in the registry — fine on typical bars; if your
 * canvas is 4K you'll notice the cost.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/firestorm/fragment.glsl?raw';

export const FIRESTORM_BACKDROP = buildBackdropFromMapFx({
  kindId:      'firestorm',
  kind:        OVERLAY_KIND_REGISTRY.firestorm,
  shaderText,
  colourLabel: 'Fire Core',
});
