/**
 * Perceptual volume taper for the soundboard.
 *
 * HTMLMediaElement.volume and Web Audio GainNode.gain are LINEAR amplitude
 * controls, but human loudness perception is roughly logarithmic. Wiring a
 * linear fader straight to gain crams almost all the *audible* change into
 * the bottom sliver of the slider's travel — so even low positions still
 * sound loud, and the control feels broken ("the lowest setting seems
 * really loud").
 *
 * Squaring the fader position is a cheap, widely-used approximation of an
 * audio taper that restores a natural feel: the midpoint now sounds roughly
 * half as loud, and the low end is genuinely quiet, while 0 and 1 map to
 * themselves so full-scale and silence are unchanged.
 *
 * Stored slot volumes + the soundboard wire protocol keep carrying the raw
 * fader POSITION (0..1); the curve is applied only at the moment gain hits
 * an audio node, so GM and player views stay in lock-step.
 */
export function perceptualVolume(position: number): number {
  const p = Math.max(0, Math.min(1, position));
  return p * p;
}
