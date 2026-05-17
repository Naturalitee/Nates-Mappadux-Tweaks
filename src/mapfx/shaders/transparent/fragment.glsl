// Make Transparent — punches alpha holes in the framebuffer. The
// clip-pass downstream sees these holes via tDiffuse.a and mixes
// the active backdrop in behind, so a painted region of any map
// reveals the backdrop wherever the GM brushes.
//
// MapFX-only; doesn't make sense as a backdrop (nothing to make
// transparent in the bars).
//
// Blend mode in the renderer is custom — see Renderer.ts where
// k.blend === 'maketransparent' is handled. RGB factors leave the
// destination untouched; alpha factors do dstAlpha *= (1 - srcAlpha).
// This shader's job is to output srcAlpha = polygon-mask-coverage
// so the alpha-multiplication scales linearly with how much of the
// pixel the polygon covers (edges + edgeFade soften naturally).

uniform sampler2D uMask;
varying vec2 vUv;

void main() {
  float m = texture2D(uMask, vUv).a;
  // Discard rather than write alpha=0 outside the polygon so we
  // never touch destination alpha there. (If we wrote srcAlpha=0,
  // finalAlpha = dstAlpha * (1 - 0) = dstAlpha, unchanged — same
  // result, but discard is cheaper and avoids any blending math.)
  if (m < 0.01) discard;
  // Source colour is unused (blendSrc = Zero). Alpha = mask, which
  // becomes the strength of the alpha-removal: full inside, soft
  // at edges if the GM enabled edgeFade.
  gl_FragColor = vec4(0.0, 0.0, 0.0, m);
}
