/**
 * Starfield backdrop — derived from the MapFX 'starfield' kind. One
 * source (src/mapfx/shaders/starfield/fragment.glsl) drives both
 * subsystems via the backdrop wrapper.
 *
 * Adapted from "StarField practice" by Deadtotem (2020) — see
 * ACKNOWLEDGEMENTS.md. Original Shadertoy entry:
 * https://www.shadertoy.com/view/tllfRX
 *
 * The unified version exposes the full param set in the popover:
 * Star Colour, Intensity, Scale (density), Speed, Direction, Glow.
 * Same controls as MapFX — defaults reproduce the original
 * violet/lilac haloed orbs warping at the original pace.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/starfield/fragment.glsl?raw';

export const STARFIELD_BACKDROP = buildBackdropFromMapFx({
  kindId:      'starfield',
  kind:        OVERLAY_KIND_REGISTRY.starfield,
  shaderText,
  colourLabel: 'Star Colour',
});
