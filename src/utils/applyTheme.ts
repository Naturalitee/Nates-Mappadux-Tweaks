import type { ThemeConfig } from '../types.ts';
import type { Renderer } from '../rendering/Renderer.ts';

/**
 * Apply a ThemeConfig to the document. Theme persists by toggling
 * `data-theme` on `<html>` for the dark/light variant, and setting an
 * `--accent` CSS custom property on the same element for any custom accent
 * the creator picked. Empty / null config restores defaults.
 *
 * The map render area is intentionally unaffected by chrome theming —
 * but the per-pack animated backdrop (v2.12) DOES live on ThemeConfig,
 * and is pushed into the supplied Renderer when one is provided.
 */
export function applyTheme(theme: ThemeConfig | undefined, renderer?: Renderer): void {
  const root = document.documentElement;

  // Mode (dark is the default; only light requires the data-attribute).
  if (theme?.mode === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }

  // Accent — strip and re-set so changing back to default cleans up.
  if (theme?.accent && /^#?[0-9a-fA-F]{3,8}$/.test(theme.accent.trim())) {
    const hex = theme.accent.trim().startsWith('#') ? theme.accent.trim() : `#${theme.accent.trim()}`;
    root.style.setProperty('--accent', hex);
  } else {
    root.style.removeProperty('--accent');
  }

  // Backdrop — propagated into the renderer when one is supplied so the
  // GM canvas re-skins the bars area. AboutDialog's live-preview path
  // doesn't have direct renderer access, so it relies on the GMApp to
  // pipe its renderer through here on save.
  if (renderer) {
    renderer.setBackdrop(theme?.backdrop ?? null);
  }
}
