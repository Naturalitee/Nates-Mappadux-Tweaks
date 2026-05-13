// Heat Haze — top-down map shimmer. The frame is the ground seen from above,
// so there's no "up" direction for heat to rise into — instead we get
// patches of distortion that bloom and drift across the whole surface, the
// way you'd see warm air pockets over an aerial desert shot. Two noise
// fields scrolling in different directions drive a 2D distortion vector
// per pixel; warm wash + highlight bleach finish the "hot" feel.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uShimmer;
uniform float     uSpeed;
uniform float     uPatchiness;
uniform float     uWarmth;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  // Aspect-correct so patches stay roughly round regardless of screen shape.
  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  // Patchiness slider trades broad smooth shimmer (low) for crunchy
  // localised heat-pockets (high) by tightening the noise scale.
  float scale = mix(3.5, 9.0, uPatchiness);

  // Two noise fields scrolling in different directions — gives the brain
  // separate "shimmer columns" rather than one drifting wave.
  vec2 nUvA = aUv * scale         + vec2( time * uSpeed * 0.20, time * uSpeed * 0.13);
  vec2 nUvB = aUv * scale * 1.7   + vec2(-time * uSpeed * 0.11, time * uSpeed * 0.27);

  // Sample at two offsets per field to derive a 2D distortion direction
  // (cheap gradient — direction = (noise(x+e) - noise(x-e), ...)).
  float e = 0.10;
  float nA1 = vnoise(nUvA + vec2(e, 0.0)) - vnoise(nUvA - vec2(e, 0.0));
  float nA2 = vnoise(nUvA + vec2(0.0, e)) - vnoise(nUvA - vec2(0.0, e));
  float nB1 = vnoise(nUvB + vec2(e, 0.0)) - vnoise(nUvB - vec2(e, 0.0));
  float nB2 = vnoise(nUvB + vec2(0.0, e)) - vnoise(nUvB - vec2(0.0, e));

  vec2 displace = (vec2(nA1, nA2) * 0.6 + vec2(nB1, nB2) * 0.4) * 0.020 * uShimmer;

  vec4 color = texture2D(tDiffuse, vUv + displace);

  // Warm wash + slight highlight bleach. Multiplicative warm tint, then a
  // cheap bloom-style brighten on already-bright pixels so the hottest
  // patches shimmer toward white.
  vec3 warm = vec3(1.14, 0.95, 0.78);
  color.rgb = mix(color.rgb, color.rgb * warm, uWarmth);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb += vec3(0.12) * smoothstep(0.7, 1.0, luma) * uWarmth;

  gl_FragColor = color;
}
