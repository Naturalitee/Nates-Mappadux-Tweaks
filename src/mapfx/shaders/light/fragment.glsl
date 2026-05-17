// Magical Light — in-house Mappadux shader. Radial glow + animated
// swirls + sparkle particles, all tinted by uColor. One source for
// MapFX (polygon-masked light region) and Backdrop (full-bars
// ambient glow — note the radial falloff means light is brightest
// at the canvas centre, so a backdrop use shows mostly the outer
// halo bleeding into the bars; better for "cozy edges" than
// "filled bars").

// === BEGIN backdrop-shareable ===
uniform sampler2D uNoise;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;
uniform float     uSwirls;
uniform float     uParticles;

float _light_hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 fxEffect(vec2 uv) {
  // Radial falloff from the region centre.
  vec2 d = uv - 0.5;
  float r = length(d);
  float radial = smoothstep(0.7, 0.0, r);

  // Base glow + subtle noise breakup so the light doesn't read as a
  // perfectly smooth gradient.
  vec2 baseUv = uv * (2.0 / max(uScale, 0.01)) + vec2(time * uSpeed * 0.02);
  vec3 baseTex = texture2D(uNoise, baseUv).rgb;
  float baseMod = 0.7 + 0.3 * baseTex.r;
  vec3 baseLight = uColor * radial * baseMod * 0.6;

  // Swirls — polar-coord noise warp drifting around the centre.
  vec3 swirl = vec3(0.0);
  if (uSwirls > 0.001) {
    float t = time * uSpeed * 0.3;
    float a = atan(d.y, d.x);
    vec2 spiralUv = vec2(
      a / 6.283185 + r * 1.5 + t * 0.4,
      r * 4.0 + t * 0.1
    ) * (1.5 / max(uScale, 0.01));
    float swirlA = texture2D(uNoise, spiralUv).r;
    float swirlB = texture2D(uNoise, spiralUv * 1.7 + vec2(0.31, 0.84) + t * 0.08).g;
    float wisp = (swirlA + swirlB) * 0.5;
    wisp = pow(wisp, 1.4);
    swirl = uColor * wisp * uSwirls * 1.2 * (0.5 + 0.5 * radial);
  }

  // Particles — grid-cell hash for stable positions + sin twinkle.
  vec3 particles = vec3(0.0);
  if (uParticles > 0.001) {
    float t = time * uSpeed;
    float partScale = 35.0 / max(uScale, 0.01);
    vec2 cell      = floor(uv * partScale);
    vec2 cellLocal = fract(uv * partScale);
    float h = _light_hash(cell);
    float threshold = mix(0.985, 0.82, uParticles);
    if (h > threshold) {
      vec2 centred = cellLocal - 0.5;
      float dist   = length(centred);
      float dotMask = smoothstep(0.35, 0.0, dist);
      float twinkle = 0.4 + 0.6 * sin(t * 3.0 + h * 100.0);
      vec3 tint = mix(uColor, vec3(1.0), 0.3 * _light_hash(cell + 13.7));
      particles = tint * dotMask * max(0.0, twinkle) * uParticles * 1.8;
    }
  }

  vec3 col = (baseLight + swirl + particles) * uIntensity;
  return vec4(col, 1.0);
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
  // Additive blend; mask coverage gates the addition at the edges.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
