// Starfield — adapted from "StarField practice" by Deadtotem (2020).
// Used under CC-BY-NC-SA 3.0 — see ACKNOWLEDGEMENTS.md.
//
// One source for MapFX (polygon-masked) and Backdrop (full-bars via
// the wrapper). Direction + glow + speed + colour all live as
// shader params; the marker block below is what the backdrop
// wrapper lifts into the clip-pass.

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uScale;
uniform float uSpeed;
uniform float uDirection; // 0..π — 0 approaching, π/2 sideways, π receding
uniform float uGlow;      // 0..1 — pinpoint stars (0) to full haloed orbs (1)

#define _SF_NUM_LAYERS 8
#define _SF_TAU 6.28318
#define _SF_GLOW 0.025
#define _SF_CANVAS 20.0

float _sf_star(vec2 uv, float flare) {
  float d = length(uv);
  // At uGlow=0 we collapse to crisp pinpoints; at uGlow=1 we keep
  // the original 1/d radial halo. Rays only contribute proportional
  // to glow so pinpoint mode reads as clean dots.
  float halo = mix(
    smoothstep(0.08, 0.0, d),
    sin(_SF_GLOW * 1.2) / max(d, 1e-4),
    uGlow
  );
  float rays = max(0.0, 0.5 - abs(uv.x * uv.y * 1000.0));
  float m = halo + (rays * flare) * 2.0 * uGlow;
  m *= smoothstep(1.0, 0.1, d);
  return m;
}

float _sf_hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 _sf_layer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv);
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offs = vec2(float(x), float(y));
      float n    = _sf_hash21(id + offs);
      float size = fract(n);
      float star = _sf_star(gv - offs - vec2(n, fract(n * 34.0)) + 0.5,
                            smoothstep(0.1, 0.9, size) * 0.46);
      // Per-star hue variance, narrow enough that uColor dominates.
      vec3 baseColor = sin(vec3(0.5, 0.6, 0.7) * fract(n * 2345.2) * _SF_TAU) * 0.25 + 0.75;
      baseColor *= vec3(0.95, 0.9, 0.95 + size * 0.1);
      vec3 color = baseColor * uColor;
      // Per-star twinkle.
      star *= sin(time * 0.6 + n * _SF_TAU) * 0.5 + 0.5;
      col += star * size * color;
    }
  }
  return col;
}

vec4 fxEffect(vec2 uv) {
  // Centered + aspect-corrected so stars stay round and parallax
  // doesn't squash on rectangular regions.
  uv -= 0.5;
  uv.x *= uAspect;

  // Direction sweep: cos drives forward depth-warp rate (positive
  // at 0 = approaching, negative at π = receding); sin drives
  // lateral horizontal scroll (π/2 = pure sideways flight).
  float forward = cos(uDirection);
  float lateral = sin(uDirection);

  // Warp travel rate. Original Velocity = 0.025; uScale tunes
  // density, uSpeed tunes rate.
  float t = time * uSpeed * 0.025 * forward;
  vec2 lateralOffset = vec2(lateral * time * uSpeed * 0.8, 0.0);

  vec3 col = vec3(0.0);
  for (int li = 0; li < _SF_NUM_LAYERS; li++) {
    float i = float(li) / float(_SF_NUM_LAYERS);
    float depth = fract(i + t);
    float scale = mix(_SF_CANVAS / max(uScale, 0.01), 0.5, depth);
    float fade  = depth * smoothstep(1.0, 0.9, depth);
    col += _sf_layer(uv * scale + i * 453.2 - time * 0.05 + lateralOffset) * fade;
  }

  return vec4(col * uIntensity, 1.0);
}
// === END backdrop-shareable ===

uniform sampler2D uMask;
varying vec2 vUv;

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 c = fxEffect(vUv);
  // Additive blend; pre-multiply by maskAlpha so polygon coverage
  // modulates the contribution naturally at the polygon edges.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
