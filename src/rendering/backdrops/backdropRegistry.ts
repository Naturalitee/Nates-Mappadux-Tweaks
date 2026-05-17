/**
 * Animated backdrops — rendered in the letterbox / pillarbox area of the
 * GM canvas (the bars left empty around the map rectangle). Each entry
 * provides a GLSL snippet that the Renderer's clip-pass injects into its
 * "outside the viewport" branch. Inside the viewport the clip pass
 * continues to pass the composed scene through untouched, so the map
 * itself is never overlaid by the backdrop — only dead bars are dressed.
 *
 * Snippet contract:
 *   • Receives the same fragment uniforms as the clip pass:
 *       uBgColor (vec3, linear),
 *       time     (float, seconds since renderer start),
 *       uSpeed   (float, GM-tuned scalar; defaults to 1.0),
 *       vUv      (varying, full-canvas 0..1 UV).
 *   • Must end with `gl_FragColor = vec4(<color>, 1.0);` — opaque output.
 *   • Should never `discard` (would leave a hole in the bars).
 *
 * Adding a new backdrop: create a sibling file exporting `id`, `label`,
 * and `fragment` strings, register it in BACKDROPS.
 */

import { STARFIELD_BACKDROP }  from './starfield.ts';
import { AURORA_BACKDROP }     from './aurora.ts';
import { EMBERS_BACKDROP }     from './embers.ts';
import { SMOOTH_FOG_BACKDROP } from './smoothFog.ts';
import { FIRESTORM_BACKDROP }  from './firestorm.ts';

export interface BackdropEntry {
  /** Stable id stored on the pack's ThemeConfig.backdrop.kind. */
  id:       string;
  /** Human-readable name for the dropdown. */
  label:    string;
  /** GLSL body for the "outside uRect" branch of the clip-pass shader. */
  fragment: string;
  /**
   * v2.12 — optional GM-tunable shader parameters. Each entry becomes
   * a uniform in the clip pass fragment shader using the standard
   * `u<PascalCase>` naming (e.g. id 'tint' → uniform vec3 uTint).
   * Sliders/toggles bind as `float`, colour params as `vec3`.
   *
   * Reuses the MapFX ShaderParamDef discriminated union so the same
   * panel-row helpers render controls for both subsystems.
   */
  params?:  import('../../mapfx/overlayKindRegistry.ts').ShaderParamDef[];
  /**
   * v2.12 — optional GLSL injected at top scope (before `void main()`)
   * for backdrops that need helper functions (noise, FBM, raymarch
   * step, etc.). The `fragment` snippet itself is dropped inside the
   * `if (outside-viewport)` branch of main and so cannot define its
   * own functions. Top-scope content lives here instead and can be
   * called freely from the fragment snippet.
   *
   * Don't redeclare the built-in uniforms (tDiffuse, uRect, uBgColor,
   * time, uSpeed, uResolution) or any param uniforms — those are
   * injected automatically by the clip-pass builder.
   */
  helpers?: string;
}

export const BACKDROPS: BackdropEntry[] = [
  { id: 'none', label: 'None (solid colour)', fragment: 'gl_FragColor = vec4(uBgColor, 1.0);' },
  STARFIELD_BACKDROP,
  AURORA_BACKDROP,
  EMBERS_BACKDROP,
  SMOOTH_FOG_BACKDROP,
  FIRESTORM_BACKDROP,
];

export function backdropById(id: string): BackdropEntry {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0]!;
}
