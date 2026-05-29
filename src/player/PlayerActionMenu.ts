/**
 * PlayerActionMenu (v2.17 Player Voice) — small context popup shown when a
 * player right-clicks or long-presses the map. Patch 2 offers "Ping here";
 * later patches add private-message actions. Self-dismisses on outside click,
 * Escape, scroll, or selection.
 */

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export class PlayerActionMenu {
  private el: HTMLElement | null = null;
  private onDocPointer = (e: Event) => {
    if (this.el && !this.el.contains(e.target as Node)) this.close();
  };
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };

  /** Open at viewport coords with the given items. Items with no enabled
   *  entries are skipped — the menu only opens if there's something to show. */
  open(clientX: number, clientY: number, items: ActionMenuItem[]): void {
    const visible = items.filter((i) => !i.disabled);
    if (visible.length === 0) return;
    this.close();

    const el = document.createElement('div');
    el.className = 'player-action-menu';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-action-menu-item';
      btn.textContent = item.label;
      btn.disabled = !!item.disabled;
      btn.addEventListener('click', () => { this.close(); item.onSelect(); });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    this.el = el;

    // Position, keeping the menu within the viewport.
    const rect = el.getBoundingClientRect();
    const x = Math.min(clientX, window.innerWidth  - rect.width  - 8);
    const y = Math.min(clientY, window.innerHeight - rect.height - 8);
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top  = `${Math.max(8, y)}px`;

    // Defer listener attach so the opening click/contextmenu doesn't instantly close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', this.onDocPointer, true);
      document.addEventListener('keydown', this.onKey, true);
      window.addEventListener('scroll', this.onDocPointer, true);
    }, 0);
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('scroll', this.onDocPointer, true);
  }
}
