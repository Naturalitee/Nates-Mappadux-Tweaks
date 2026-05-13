// Rain — top-down view. The frame is the ground seen from above, so rain
// reads as expanding ring-ripples where individual drops strike, not
// falling streaks. A hash-cell grid picks splash locations; each cell
// uses an INDEPENDENT hash seed for its time phase so active cells don't
// march in lockstep. Two layered grids with their own seeds give size +
// timing variety.
//
// Two atmosphere sliders:
//   • Overcast  — darken + desaturate (cloudy sky overhead, lit-from-above
//                 takes a hit). Mirrors the side-view Rain's overcast.
//   • Wet Surface — slight darken + saturation LIFT (wet things look more
//                 saturated under diffuse light). Stack-friendly with overcast.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uDensity;
uniform float     uSpeed;
uniform float     uOvercast;
uniform float     uWet;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

// One ripple layer.
//   • hGate decides if/how-much this cell splashes (density gate)
//   • hPhase (different seed) is the time offset so active cells scatter
//     through the splash cycle rather than firing in sync
//   • hPos jitters the splash position inside the cell so they don't grid-align
//   • hSize varies the splash radius cell-to-cell
float ripple(vec2 uv, float cellScale, float seedSalt) {
  vec2 cell = floor(uv * cellScale);
  vec2 f    = fract(uv * cellScale) - 0.5;

  float hGate  = hash21(cell + vec2(seedSalt, 0.0));
  if (hGate < 1.0 - uDensity) return 0.0;

  float hPhase = hash21(cell + vec2(seedSalt + 31.7, 17.3));
  float hPos1  = hash21(cell + vec2(seedSalt + 7.1,  41.9));
  float hPos2  = hash21(cell + vec2(seedSalt + 13.6, 5.2));
  float hSize  = hash21(cell + vec2(seedSalt + 51.4, 23.8));

  vec2 jitter = (vec2(hPos1, hPos2) - 0.5) * 0.6;
  vec2 fc = f - jitter;

  float period = 1.4;
  float lifeT = fract(time * uSpeed / period + hPhase);

  float r = length(fc);

  float maxR  = mix(0.35, 0.55, hSize);
  float ringR = lifeT * maxR;
  float ringW = mix(0.03, 0.09, lifeT);
  float ring  = exp(-pow((r - ringR) / ringW, 2.0));

  float impact = smoothstep(0.05, 0.0, r) * smoothstep(0.10, 0.0, lifeT);
  float life   = (1.0 - lifeT) * (1.0 - lifeT);

  return ring * life + impact;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Overcast — cloudy-sky desaturate + darken. Mirrors side-view Rain.
  if (uOvercast > 0.001) {
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(grey), 0.30 * uOvercast);
    color.rgb *= (1.0 - 0.35 * uOvercast);
  }

  // Wet-surface — slight saturation LIFT (wet things look more saturated)
  // and a smaller darken on top. Stacks naturally with overcast.
  if (uWet > 0.001) {
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(grey), color.rgb, 1.0 + 0.20 * uWet);
    color.rgb *= (1.0 - 0.18 * uWet);
  }

  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  float ripples = 0.0;
  ripples += ripple(aUv, 35.0, 0.0)   * 0.95;
  ripples += ripple(aUv, 70.0, 19.4)  * 0.55;
  ripples = clamp(ripples * uIntensity, 0.0, 1.0);

  vec3 wetCol = vec3(0.80, 0.92, 1.08);
  color.rgb = mix(color.rgb, wetCol, ripples * 0.85);

  gl_FragColor = color;
}
