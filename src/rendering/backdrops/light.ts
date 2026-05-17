/**
 * Magical Light backdrop — derived from the MapFX 'light' kind.
 *
 * Caveat: light's radial falloff means brightness peaks at the
 * canvas centre and fades to 0 by the edges. In MapFX use the
 * "centre" is the polygon centre, which the GM controls by where
 * they paint. As a backdrop, the centre is the canvas centre —
 * which is INSIDE the viewport, not in the bars. The bars only
 * see the outer halo bleeding through. Reads as a soft tinted
 * glow framing the map; less useful for "fill the bars with
 * light", more useful for "cozy edges". GMs who want bright bars
 * should pick Aurora / Embers / Noise instead.
 *
 * Pair Swirls + Particles for a "magical sanctum" vibe.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/light/fragment.glsl?raw';

export const LIGHT_BACKDROP = buildBackdropFromMapFx({
  kindId:      'light',
  kind:        OVERLAY_KIND_REGISTRY.light,
  shaderText,
  colourLabel: 'Light Hue',
});
