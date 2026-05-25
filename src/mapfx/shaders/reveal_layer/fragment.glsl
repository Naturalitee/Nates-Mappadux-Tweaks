// Reveal Map Layer — positively draws the composite's "minus topmost
// tile" backing texture inside the polygon mask. The polygon plane
// sits above the main map plane (z > 0); inside the mask we render
// the backing colour, outside we discard. The visual result: where
// the GM paints, the tile DIRECTLY UNDERNEATH the topmost shows
// through; everywhere else the main map is untouched.
//
// Distinction from 'transparent': transparent punches framebuffer
// alpha so the clip-pass mixes the active backdrop in. reveal_layer
// doesn't touch the framebuffer alpha — it draws the backing on top
// with NormalBlending. Backdrop never enters the equation, which is
// the point: the GM wants to see the LAYER below, not the scenery.
//
// uBackingUv maps polygon-plane UVs (0..1 inside the plane) to the
// backing texture's UV space (0..1 over the full backing). Mirrors
// the uMap / uMapUv pattern other shaders use.
//
// No backing texture? Renderer wires a 1x1 transparent placeholder so
// the shader executes harmlessly (alpha=0) on non-layered maps.

uniform sampler2D uMask;
uniform sampler2D uBacking;
uniform vec4      uBackingUv;
varying vec2      vUv;

void main() {
  float m = texture2D(uMask, vUv).a;
  if (m < 0.01) discard;
  vec2 backingUv = uBackingUv.xy + vUv * uBackingUv.zw;
  vec4 backing = texture2D(uBacking, backingUv);
  // Multiply by mask so soft polygon edges (edgeFade) feather the
  // reveal naturally instead of cutting hard. Where the backing is
  // transparent (sampled location not covered by the lower tile),
  // alpha goes to 0 and the brush is a visual no-op — the main
  // map shows through unaffected. Same for non-layered maps via
  // the placeholder texture.
  gl_FragColor = vec4(backing.rgb, m * backing.a);
}
