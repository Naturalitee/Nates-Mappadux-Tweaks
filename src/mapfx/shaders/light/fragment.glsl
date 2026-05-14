// Magical Light — in-house Mappadux shader (no third-party adaptation).
//
// Behaviour: the polygon's area becomes brighter on the map via additive
// blending (configured on the material). Three independent layers stack:
//
//   1) Radial glow — a soft brighter centre fading out toward the polygon
//      edge. Always present; uIntensity scales it.
//   2) Swirls (uSwirls) — animated noise patterns in polar coordinates,
//      drifting around the polygon centre. Reads as "swirling magical
//      energy" when the polygon is even vaguely round.
//   3) Particles (uParticles) — sparse twinkling bright dots scattered
//      through the polygon area. Density + twinkle rate tunable.
//
// All three layers are tinted by uColor so the GM picks the light hue —
// warm gold torches, cold blue spirit-light, sickly green eldritch
// corruption, etc. Additive blend means the map underneath shines through
// at low intensity and is wholly drowned out at high intensity.

uniform sampler2D uMask;
uniform sampler2D uNoise;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;
uniform float     uSwirls;
uniform float     uParticles;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Radial falloff so the polygon's centre is the brightest point.
  // smoothstep with 0.7 at the inner edge gives a soft fade that
  // doesn't quite reach zero before the polygon boundary — the mask
  // cuts the rest, giving a clean edge without a hard light "disc"
  // shape.
  vec2 d = vUv - 0.5;
  float r = length(d);
  float radial = smoothstep(0.7, 0.0, r);

  // Subtle organic texture in the base glow so the light doesn't read
  // as a perfectly smooth gradient. Mild — only modulates 30% of base.
  vec2 baseUv = vUv * (2.0 / max(uScale, 0.01)) + vec2(time * uSpeed * 0.02);
  vec3 baseTex = texture2D(uNoise, baseUv).rgb;
  float baseMod = 0.7 + 0.3 * baseTex.r;

  vec3 baseLight = uColor * radial * baseMod * 0.6;

  // Swirls — polar-coord noise warp that drifts around the polygon
  // centre. The atan + r combination makes the noise sample wrap
  // around the polygon, so the visible texture spirals visually.
  vec3 swirl = vec3(0.0);
  if (uSwirls > 0.001) {
    float t = time * uSpeed * 0.3;
    float a = atan(d.y, d.x);
    // Wind the noise UV around the polygon centre: angular axis →
    // x, radial axis → y. Adding t to the angle drifts the pattern
    // rotationally over time.
    vec2 spiralUv = vec2(
      a / 6.283185 + r * 1.5 + t * 0.4,
      r * 4.0 + t * 0.1
    ) * (1.5 / max(uScale, 0.01));
    float swirlA = texture2D(uNoise, spiralUv).r;
    float swirlB = texture2D(uNoise, spiralUv * 1.7 + vec2(0.31, 0.84) + t * 0.08).g;
    float wisp = (swirlA + swirlB) * 0.5;
    // Bias toward bright wisps so the swirl reads as glowing strands
    // rather than a uniform brightness modulation.
    wisp = pow(wisp, 1.4);
    swirl = uColor * wisp * uSwirls * 1.2 * (0.5 + 0.5 * radial);
  }

  // Particles — sparse twinkling dots scattered through the polygon.
  // Grid-cell hash for stable positions; sin(time + hash) for twinkle.
  // Higher uParticles → lower hash threshold → more visible dots.
  vec3 particles = vec3(0.0);
  if (uParticles > 0.001) {
    float t = time * uSpeed;
    float partScale = 35.0 / max(uScale, 0.01);
    vec2 cell      = floor(vUv * partScale);
    vec2 cellLocal = fract(vUv * partScale);
    float h = hash(cell);
    // Threshold sweeps from 0.985 (very sparse at uParticles=0.05) to
    // 0.82 (dense at uParticles=1).
    float threshold = mix(0.985, 0.82, uParticles);
    if (h > threshold) {
      vec2 centred = cellLocal - 0.5;
      float dist   = length(centred);
      float dot    = smoothstep(0.35, 0.0, dist);
      float twinkle = 0.4 + 0.6 * sin(t * 3.0 + h * 100.0);
      // Slight per-particle hue variance via the cell hash, blended
      // back toward uColor.
      vec3 tint = mix(uColor, vec3(1.0), 0.3 * hash(cell + 13.7));
      particles = tint * dot * max(0.0, twinkle) * uParticles * 1.8;
    }
  }

  // Sum everything and ramp by intensity. Additive blend on the
  // material adds this directly to the underlying map.
  vec3 col = (baseLight + swirl + particles) * uIntensity;

  // Pre-multiplied output for AdditiveBlending: src.rgb * src.a + dst.
  // Mask coverage modulates the addition.
  gl_FragColor = vec4(col * maskAlpha, maskAlpha);
}
