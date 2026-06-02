/**
 * PingLayer (v2.17 Player Voice) — renders map pings as screen-space pulses.
 *
 * Shared by the player view and the GM view:
 *   - Player: pulses auto-fade after a TTL (default 10s), no label.
 *   - GM: pulses persist until the GM dismisses them, with the originator's
 *     name beneath and a single delete button.
 *
 * Each ping is anchored to a normalised map coordinate. A self-driving RAF
 * reprojects every live ping each frame (so they track the map through pan /
 * zoom) and prunes expired ones; the loop stops itself when no pings remain,
 * mirroring the motion-tracker overlay's pattern. The container is expected to
 * be a screen-space layer aligned with the canvas (pointer-events:none); the
 * GM delete buttons opt back into pointer events.
 */

export interface PingLayerOptions {
  /** Show the originator's name beneath the pulse (GM view). */
  showLabel: boolean;
  /** Pings persist until dismissed (GM); otherwise auto-fade after ttlMs. */
  persistent: boolean;
  /** Time-to-live for non-persistent pings, ms. Default 10000. */
  ttlMs?: number;
  /** Called when a persistent ping's delete button is clicked. */
  onDismiss?: (id: string) => void;
}

interface PingInstance {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
  bornAt: number;
  el: HTMLElement;
}

const FADE_MS = 800; // tail fade for non-persistent pings

export class PingLayer {
  private items = new Map<string, PingInstance>();
  private rafId: number | null = null;

  constructor(
    private container: HTMLElement,
    /** normalised map coord → canvas-relative CSS px (null when off-screen). */
    private project: (x: number, y: number) => { x: number; y: number } | null,
    private opts: PingLayerOptions,
  ) {}

  /** Add (or replace) a ping. */
  add(item: { id: string; x: number; y: number; color: string; name: string }): void {
    this.remove(item.id);
    const el = this._buildEl(item);
    this.container.appendChild(el);
    this.items.set(item.id, { ...item, bornAt: performance.now(), el });
    this._kick();
  }

  remove(id: string): void {
    const inst = this.items.get(id);
    if (inst) { inst.el.remove(); this.items.delete(id); }
  }

  clearAll(): void {
    for (const inst of this.items.values()) inst.el.remove();
    this.items.clear();
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private _buildEl(item: { color: string; name: string; id: string }): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ping';
    el.style.setProperty('--ping-color', item.color);

    // Three concentric rings zeroing in on the point, staggered so a fresh
    // ring is always converging — reads as "look here" rather than a radar ping.
    const RING_COUNT = 3;
    const CYCLE_MS = 1350;
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = document.createElement('span');
      ring.className = 'ping-ring';
      ring.style.animationDelay = `${(-i * CYCLE_MS) / RING_COUNT}ms`;
      el.appendChild(ring);
    }
    const dot = document.createElement('span');
    dot.className = 'ping-dot';
    el.appendChild(dot);

    if (this.opts.showLabel && item.name) {
      const label = document.createElement('span');
      label.className = 'ping-label';
      label.textContent = item.name;
      el.appendChild(label);
    }

    if (this.opts.persistent && this.opts.onDismiss) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ping-dismiss';
      del.title = 'Dismiss this ping';
      del.setAttribute('aria-label', 'Dismiss ping');
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.remove(item.id);
        this.opts.onDismiss?.(item.id);
      });
      el.appendChild(del);
    }

    return el;
  }

  private _kick(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      const now = performance.now();
      const ttl = this.opts.ttlMs ?? 10000;
      for (const inst of [...this.items.values()]) {
        const age = now - inst.bornAt;
        if (!this.opts.persistent && age >= ttl) { this.remove(inst.id); continue; }
        const p = this.project(inst.x, inst.y);
        if (!p) { inst.el.style.display = 'none'; continue; }
        inst.el.style.display = '';
        inst.el.style.left = `${p.x}px`;
        inst.el.style.top  = `${p.y}px`;
        // Tail fade for the last FADE_MS of a non-persistent ping.
        if (!this.opts.persistent && age > ttl - FADE_MS) {
          inst.el.style.opacity = String(Math.max(0, (ttl - age) / FADE_MS));
        }
      }
      this.rafId = this.items.size > 0 ? requestAnimationFrame(tick) : null;
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
