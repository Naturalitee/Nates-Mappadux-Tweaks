import type { Marker } from '../../types.ts';

/**
 * Per-call context passed to every interaction. Built by GMApp around the
 * authoritative live state — interactions never read state directly.
 */
export interface InteractionContext {
  /** Current marker array. */
  markers: Marker[];
  /** Send a P2P message to all connected players. */
  broadcast: (msg: any) => void;
}

/**
 * One independent marker-driven system (positional audio, motion tracker, etc.).
 *
 * The registry calls `onMarkersChanged` on every state mutation, `onMapLoaded`
 * once per map switch (after state has been fully restored), and `reset` when
 * switching away from the previous map.
 *
 * Implementations own their own engine/runtime state. They mutate marker state
 * through the host application, never directly.
 */
export interface MarkerInteraction {
  readonly id: string;

  /** Reconcile the interaction's runtime with the current marker state. */
  onMarkersChanged(ctx: InteractionContext): void;

  /** Optional one-shot hook fired after a new map's state finishes loading. */
  onMapLoaded?(ctx: InteractionContext): Promise<void>;

  /** Optional cleanup hook fired before the next map's state is loaded. */
  reset?(): void;
}

/**
 * Holds and dispatches to every registered interaction. GMApp owns one of these.
 */
export class MarkerInteractionRegistry {
  private _list: MarkerInteraction[] = [];

  register<T extends MarkerInteraction>(i: T): T {
    this._list.push(i);
    return i;
  }

  notifyMarkersChanged(ctx: InteractionContext): void {
    for (const i of this._list) i.onMarkersChanged(ctx);
  }

  async notifyMapLoaded(ctx: InteractionContext): Promise<void> {
    await Promise.all(this._list.map((i) => i.onMapLoaded?.(ctx) ?? Promise.resolve()));
  }

  reset(): void {
    for (const i of this._list) i.reset?.();
  }
}
