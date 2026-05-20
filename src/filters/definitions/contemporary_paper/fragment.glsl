// Contemporary Paper — modern notebook / printer / graph paper filter.
//
// Pipeline:
//   1. Tint the scene toward the chosen paper colour.
//   2. Apply procedural grain (no texture file needed).
//   3. Overlay ruling lines (blank / lined / graph-blue / graph-black).
//   4. Add procedural ink blots + smudges (cheap, screen-space).
//   5. Crumple — multiplicative shading from a simulated wrinkle pattern.
//   6. Torn edges — ragged opacity falloff that eats into the image.
//
// All passes are gated by their respective slider values so a 0-setting
// short-circuits. Keep maths in linear sRGB; OutputPass handles the
// final gamma conversion downstream.

uniform sampler2D tDiffuse;
uniform vec2  resolution;

uniform vec3  uPaperTint;
uniform float uTintStrength;
uniform float uPaperGrain;
uniform float uPaperScale;
uniform float uBrightness;

uniform float uRulingStyle;     // 0=blank, 1=lined, 2=graph-blue, 3=graph-black
uniform float uRulingSpacing;
uniform float uRulingOpacity;

uniform float uInkBlots;
uniform float uSmudge;

uniform float uCrumple;
uniform float uTorn;

varying vec2 vUv;

// ── Cheap deterministic hash for procedural noise / blots / wrinkles. ───
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Smooth value-noise built from hash. ~3 lookups; fine for screen-space.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two-octave FBM — enough texture without paying for many lookups.
float fbm2(vec2 p) {
  return 0.66 * vnoise(p) + 0.34 * vnoise(p * 2.07 + 7.3);
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 col = src.rgb;

  // ── 1. Paper tint ────────────────────────────────────────────────────
  // Multiplicative tint approximates ink-on-paper: dark map ink stays
  // dark, light areas pick up the paper colour.
  vec3 tinted = col * mix(vec3(1.0), uPaperTint, uTintStrength);
  col = tinted;

  // ── 2. Procedural paper grain ────────────────────────────────────────
  if (uPaperGrain > 0.001) {
    float g = fbm2(vUv * resolution / max(8.0, 64.0 / max(uPaperScale, 0.5)));
    float grain = (g - 0.5) * 2.0;
    col += grain * uPaperGrain * 0.08;
  }

  // ── 3. Ruling overlay ────────────────────────────────────────────────
  // Spacing is in physical pixels so the lines look consistent across
  // resolutions. Lined = horizontal-only blue rules; graph = both axes.
  if (uRulingStyle > 0.5 && uRulingOpacity > 0.001) {
    vec2 pxCoord = vUv * resolution;
    float spacing = max(4.0, uRulingSpacing);
    // Distance to nearest gridline on each axis, in pixels.
    float dx = abs(mod(pxCoord.x, spacing) - spacing * 0.5) - (spacing * 0.5 - 0.7);
    float dy = abs(mod(pxCoord.y, spacing) - spacing * 0.5) - (spacing * 0.5 - 0.7);
    float lineMask = 0.0;
    bool isLined  = uRulingStyle > 0.5 && uRulingStyle < 1.5;
    bool isGraph  = uRulingStyle > 1.5;
    if (isLined) {
      // Only horizontal rules (vary along Y).
      lineMask = smoothstep(0.7, -0.7, dy);
    } else if (isGraph) {
      // Both axes.
      lineMask = max(smoothstep(0.7, -0.7, dx), smoothstep(0.7, -0.7, dy));
    }
    vec3 lineColor;
    if (uRulingStyle > 2.5) {
      // Graph black.
      lineColor = vec3(0.08);
    } else if (uRulingStyle > 1.5) {
      // Graph blue (school exercise-book blue).
      lineColor = vec3(0.40, 0.55, 0.85);
    } else {
      // Lined blue.
      lineColor = vec3(0.40, 0.55, 0.85);
    }
    col = mix(col, lineColor, lineMask * uRulingOpacity * 0.55);
  }

  // ── 4. Ink blots + smudges ───────────────────────────────────────────
  if (uInkBlots > 0.001) {
    // Sparse dark dots — fbm in screen space, threshold then darken.
    float blotN = fbm2(vUv * 6.0 + 13.0);
    float blot = smoothstep(0.85, 0.92, blotN);
    col *= 1.0 - blot * uInkBlots * 0.75;
  }
  if (uSmudge > 0.001) {
    // Slight horizontal blur via two-tap average then mix toward result.
    vec2 px = 1.0 / resolution;
    vec3 left  = texture2D(tDiffuse, vUv - vec2(px.x * 1.5, 0.0)).rgb;
    vec3 right = texture2D(tDiffuse, vUv + vec2(px.x * 1.5, 0.0)).rgb;
    vec3 smudged = (left + right + col) / 3.0;
    col = mix(col, smudged, uSmudge * 0.6);
  }

  // ── 5. Crumple — wrinkle shading ────────────────────────────────────
  if (uCrumple > 0.001) {
    // Two scales of fbm summed give plausible creases. Lighten on the
    // peaks, darken in the valleys.
    float w = fbm2(vUv * 8.0) + 0.5 * fbm2(vUv * 22.0 + 4.0);
    w = (w - 0.65) * 1.6;
    col *= 1.0 + w * uCrumple * 0.35;
  }

  // ── 6. Torn edges ────────────────────────────────────────────────────
  // Ragged opacity mask that eats into the image at the borders. The
  // noise threshold drifts with vUv distance-to-edge so the tear stays
  // confined to the perimeter and gets wilder as torn ramps up.
  float alpha = src.a;
  if (uTorn > 0.001) {
    vec2 d = min(vUv, 1.0 - vUv);
    float edgeDist = min(d.x, d.y);                  // 0 at edge → 0.5 at centre
    float band = 0.03 + 0.10 * uTorn;
    if (edgeDist < band) {
      float n = fbm2(vUv * 18.0);
      // Closer to edge -> easier to tear away.
      float t = 1.0 - (edgeDist / band);
      float tear = step(0.55 - uTorn * 0.35, n * t);
      alpha *= 1.0 - tear;
    }
  }

  // ── Brightness + clamp ───────────────────────────────────────────────
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
