/**
 * CSS-filter approximations for the player-marker-layer DOM overlay.
 *
 * The map itself is filtered by a GLSL shader in the renderer, but player
 * tokens live in a screen-space DOM layer that the WebGL pipeline doesn't
 * touch. When the GM enables the per-map "Affect Player Markers" toggle,
 * the player + projector views apply the matching CSS filter from this
 * table so the tokens visually participate in the scene's look — without
 * having to rebuild them as WebGL sprites.
 *
 * Approximations only. The CSS `filter` property gives us blur, brightness,
 * contrast, grayscale, hue-rotate, invert, opacity, saturate, sepia and
 * drop-shadow. Stylisation filters (watercolour, oil painting, parchment,
 * etc.) don't translate to those primitives, so we return empty for them.
 * The toggle still applies — it just produces no visible change for those.
 */

export function cssApproxForFilter(filterId: string): string {
  switch (filterId) {
    case 'night_vision':
      return 'sepia(1) hue-rotate(70deg) saturate(2.4) brightness(0.85) contrast(1.1)';
    case 'thermal':
      return 'sepia(1) hue-rotate(310deg) saturate(3) contrast(1.3) brightness(0.95)';
    case 'retro_sci_fi_green':
      return 'sepia(1) hue-rotate(60deg) saturate(2.4) contrast(1.1) brightness(0.9)';
    case 'retro_sci_fi_amber':
      return 'sepia(1) hue-rotate(330deg) saturate(2.4) contrast(1.1) brightness(0.95)';
    case 'candlelight':
      return 'sepia(0.55) saturate(1.4) brightness(0.9) hue-rotate(-12deg)';
    case 'dawn_dusk':
      return 'sepia(0.35) hue-rotate(335deg) saturate(1.15) brightness(0.92)';
    case 'horror':
      return 'grayscale(0.5) contrast(1.35) brightness(0.65) saturate(0.7)';
    case 'mist':
      return 'blur(0.6px) brightness(0.92) saturate(0.55) contrast(0.95)';
    case 'underwater':
      return 'hue-rotate(180deg) saturate(1.4) brightness(0.85) contrast(0.95)';
    case 'sandstorm':
      return 'sepia(0.7) brightness(0.88) contrast(0.92) saturate(0.85)';
    case 'snow':
    case 'snow_side':
      return 'brightness(1.05) contrast(0.95) saturate(0.85)';
    case 'rain':
    case 'rain_side':
      return 'brightness(0.85) contrast(1.05) saturate(0.85)';
    case 'heat_haze':
    case 'heat_haze_side':
      return 'sepia(0.25) hue-rotate(-12deg) saturate(1.15)';
    case 'drunk':
      return 'blur(0.4px) saturate(1.4) hue-rotate(12deg)';
    case 'time_loop':
      return 'sepia(0.35) saturate(0.7) brightness(0.95)';
    // Stylisation filters — no faithful CSS analogue.
    case 'watercolor':
    case 'oil_painting':
    case 'hand_drawing':
    case 'parchment_fantasy':
    case 'contemporary_paper':
    case 'none':
    default:
      return '';
  }
}
