/**
 * HamburgerMenu — small dropdown anchored to the GM brand block.
 *
 * Lives at the top-right of the sidebar's brand block; opens a vertical list
 * of "rarely accessed" actions (About, theme, splash editor, etc.). Other
 * subsystems register items via `addItem()`; the order of registration is the
 * display order, with `footer: true` items pushed to the bottom (separated
 * by a divider) so things like About sit consistently at the foot.
 *
 * Closes on item select, click outside, or Escape.
 */
export interface HamburgerItem {
  label: string;
  onSelect: () => void;
  /** Optional icon name from MENU_ICONS — renders a small monochrome SVG
   *  next to the label so the dropdown reads as a tidy column of glyphs. */
  icon?: keyof typeof MENU_ICONS;
  /** Render at the bottom of the menu, separated from top items by a divider. */
  footer?: boolean;
  disabled?: boolean;
  /** Render as a destructive / red item (red text, hover keeps the colour).
   *  Used for actions that wipe data — paired with a confirm in the handler. */
  danger?: boolean;
}

/** Small inline-SVG icon set used by the hamburger menu. Lucide-style 24×24
 *  stroked paths, all stroke="currentColor" so the icon picks up the menu
 *  item's text colour (including the red danger variant and the dimmed
 *  disabled state). Keeping these inline avoids any runtime CDN dependency
 *  for the hamburger to look right. */
const MENU_ICONS = {
  'file-plus':    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
  'folder-open':  '<path d="M6 14 7.45 11.1A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  'save':         '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  'lock':         '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'map':          '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  'volume':       '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  'image':        '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'palette':      '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  'settings':     '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'info':         '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  // v2.14.90 — rounded square + plus, used by "Open New Instance".
  'plus-square':  '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
} as const;

/** Marker for an explicit divider between two top-section groups. */
export interface HamburgerDivider {
  divider: true;
}

export type HamburgerEntry = HamburgerItem | HamburgerDivider;

function isDivider(e: HamburgerEntry): e is HamburgerDivider {
  return (e as HamburgerDivider).divider === true;
}

export class HamburgerMenu {
  private btn: HTMLButtonElement;
  private menu: HTMLElement;
  private items: HamburgerEntry[] = [];
  private isOpen = false;

  constructor(btn: HTMLButtonElement, menu: HTMLElement) {
    this.btn = btn;
    this.menu = menu;
    this.menu.hidden = true;

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener('mousedown', this._onDocMouseDown, true);
    document.addEventListener('keydown', this._onKey);

    this._render();
  }

  addItem(item: HamburgerItem): void {
    this.items.push(item);
    this._render();
  }

  /** Explicit visual divider between two top-section groups. The auto-divider
   *  between top and footer items is unaffected. */
  addDivider(): void {
    this.items.push({ divider: true });
    this._render();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.menu.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private _render(): void {
    this.menu.replaceChildren();
    const top: HamburgerEntry[]    = this.items.filter((i) => isDivider(i) || !i.footer);
    const bottom: HamburgerItem[]  = this.items.filter((i): i is HamburgerItem => !isDivider(i) && !!i.footer);

    for (const entry of top) this.menu.appendChild(this._renderEntry(entry));

    if (top.length > 0 && bottom.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'gm-menu-sep';
      this.menu.appendChild(sep);
    }

    for (const item of bottom) this.menu.appendChild(this._renderItem(item));
  }

  private _renderEntry(entry: HamburgerEntry): HTMLElement {
    if (isDivider(entry)) {
      const sep = document.createElement('div');
      sep.className = 'gm-menu-sep';
      return sep;
    }
    return this._renderItem(entry);
  }

  private _renderItem(item: HamburgerItem): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gm-menu-item';
    el.setAttribute('role', 'menuitem');

    if (item.icon && MENU_ICONS[item.icon]) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'gm-menu-icon';
      iconWrap.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" `
        + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" `
        + `aria-hidden="true">${MENU_ICONS[item.icon]}</svg>`;
      el.appendChild(iconWrap);
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'gm-menu-label';
    labelEl.textContent = item.label;
    el.appendChild(labelEl);

    if (item.disabled) {
      el.disabled = true;
      el.classList.add('gm-menu-item--disabled');
    }
    if (item.danger) el.classList.add('gm-menu-item--danger');
    el.addEventListener('click', () => {
      this.close();
      item.onSelect();
    });
    return el;
  }

  private _onDocMouseDown = (e: MouseEvent) => {
    if (!this.isOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (this.menu.contains(target) || this.btn.contains(target)) return;
    this.close();
  };

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      this.close();
    }
  };
}
