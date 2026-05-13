// Snow — top-down view. Scattered specks of snow drifting across the map
// surface with steady wind + optional gusts. Wind speed varies with time
// via `base * (1 + uGusts * sin²(ω t + φ))` summed over two octaves, which
// gives speed ≥ base always (never reverses) — so the position integral
// stays monotonic and we never see position-jump artefacts. The integral
// of sin² has a closed form, so we can apply gusts in a single uniform
// computation per fragment, no per-frame state needed.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uDensity;
uniform float     uWindSpeed;
uniform float     uWindAngle;
uniform float     uGusts;
uniform float     uCoolTint;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

float flakeLayer(vec2 uv, float cellScale, float radiusBase) {
  vec2 cell = floor(uv * cellScale);
  vec2 f    = fract(uv * cellScale);
  float h   = hash21(cell);
  if (h < 1.0 - uDensity) return 0.0;

  // Anchor inside the cell so flakes scatter rather than grid-align.
  vec2 anchor = vec2(hash21(cell + 7.3), hash21(cell + 13.1));
  // Per-flake micro-jitter — small wobble so flakes don't look frozen mid-air.
  vec2 jitter = vec2(
    sin(time * (1.0 + h * 0.5) + h * 6.28),
    cos(time * (0.7 + h * 0.4) + h * 4.1)
  ) * 0.04;
  vec2 pos = anchor + jitter;

  float dist = length(f - pos);
  float r    = radiusBase * (0.55 + h * 0.65);
  return smoothstep(r, r * 0.35, dist) * (0.55 + 0.45 * h);
}

// Integral of sin²(ωt + φ) from 0 to t — closed-form, monotonically
// non-decreasing. Used to add gusts to the wind without position jumps.
float gustIntegral(float t, float omega, float phi) {
  // ∫sin²(ωτ + φ)dτ = t/2 - sin(2ωt + 2φ)/(4ω) + sin(2φ)/(4ω)
  return t * 0.5
       - sin(2.0 * omega * t + 2.0 * phi) / (4.0 * omega)
       + sin(2.0 * phi) / (4.0 * omega);
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Cool tint.
  if (uCoolTint > 0.001) {
    vec3 cold = color.rgb * vec3(0.92, 0.97, 1.08);
    color.rgb = mix(color.rgb, cold, uCoolTint);
  }

  // Composite wind-drift time. Steady part is just `time`. Gust part is the
  // sum of two sin² integrals — each gives speed peaks at different rates,
  // so the gusts feel irregular rather than metronome-like. Scaled so that
  // uGusts = 1 roughly doubles average wind during peaks.
  float gust = gustIntegral(time, 0.31, 1.7)
             + 0.7 * gustIntegral(time, 0.59, 4.2);
  float windT = time + uGusts * 0.7 * gust;

  // Aspect-correct UVs + uniform wind drift (direction from angle slider).
  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);
  float ang = uWindAngle * 6.2831853;
  vec2 windV = vec2(cos(ang), sin(ang)) * uWindSpeed * windT * 0.05;
  vec2 sampleUv = aUv + windV;

  // Two layered grids — broader (bigger flakes) + denser (fine specks).
  float flakes = 0.0;
  flakes += flakeLayer(sampleUv,        45.0, 0.12) * 0.75;
  flakes += flakeLayer(sampleUv * 1.7,  65.0, 0.09) * 0.55;
  flakes = clamp(flakes * uIntensity, 0.0, 1.0);

  // Flake colour — faintly cool white.
  vec3 flakeCol = vec3(0.97, 0.99, 1.0);
  color.rgb = mix(color.rgb, flakeCol, flakes);

  gl_FragColor = color;
}
