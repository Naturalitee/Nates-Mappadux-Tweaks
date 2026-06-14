/**
 * Accessibility helper for controls whose meaning isn't conveyed by visible
 * text — icon-only buttons, glyph buttons, etc.
 *
 * Sets two things from one call:
 *  - `aria-label` = the control's NAME, so screen readers announce *what* the
 *    control is (a `title` alone is unreliable for AT and invisible to
 *    keyboard focus).
 *  - `title`      = "Name — function", so the mouse-hover tooltip leads with
 *    the name before the explanation (the "name then function" convention).
 *
 * Do NOT use this on controls that already show their name as visible text —
 * the visible label is the accessible name, and a duplicate aria-label is an
 * anti-pattern. For those, pass only a description via `title` as before.
 *
 * @param name        short control name, e.g. "Add marker"
 * @param description what it does, e.g. "Add a new marker on the current map"
 */
export function labelControl(el: HTMLElement, name: string, description?: string): void {
  el.setAttribute('aria-label', name);
  el.title = description ? `${name} — ${description}` : name;
}
