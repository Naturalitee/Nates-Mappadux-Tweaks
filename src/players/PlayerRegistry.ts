import type { PersistentPlayer, MsgPlayerIdentify, MsgPlayerRoster } from '../types.ts';
import { getAllPlayers, savePlayer, deletePlayer } from '../storage/db.ts';
import { generateId } from '../utils/id.ts';
import { normaliseHex } from './playerColors.ts';

/**
 * GM-side registry of persistent players (v2.17 Player Voice).
 *
 * Owns the canonical roster (loaded from the global `players` IDB store) plus
 * the runtime binding between live connections and persistent player records.
 * GMApp delegates all player bookkeeping here so the registry can be reused by
 * later features (player markers, the initiative tracker) that also need "who
 * is this connection / who is connected right now".
 *
 * Live-binding model (security-free LAN trust):
 *   - A device player sends `player_identify` carrying a device-persisted
 *     `playerId` + a per-window `clientId`. We upsert the player and bind
 *     clientId → playerId. For PeerJS peers we also remember peerId → clientId
 *     so a transport-level disconnect can clear the binding.
 *   - Same-browser (BroadcastChannel) players have peerId 'local' and never get
 *     a transport close, so they send `player_bye` on unload.
 */
export class PlayerRegistry {
  private byId = new Map<string, PersistentPlayer>();
  /** clientId → playerId (live connections only). */
  private bindings = new Map<string, string>();
  /** peerId → clientId, for PeerJS peers, so onPeerDisconnected can clear. */
  private clientByPeer = new Map<string, string>();

  async load(): Promise<void> {
    const all = await getAllPlayers();
    this.byId.clear();
    for (const p of all) this.byId.set(p.id, p);
  }

  /** Every known persistent player, newest-updated last for stable display. */
  all(): PersistentPlayer[] {
    return [...this.byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): PersistentPlayer | undefined {
    return this.byId.get(id);
  }

  /** True if a live connection is currently bound to this player. */
  isConnected(id: string): boolean {
    for (const playerId of this.bindings.values()) if (playerId === id) return true;
    return false;
  }

  /** Resolve the persistent player bound to a given live clientId, if any. */
  playerForClient(clientId: string): PersistentPlayer | undefined {
    const id = this.bindings.get(clientId);
    return id ? this.byId.get(id) : undefined;
  }

  /** Resolve the persistent player bound to a given PeerJS peer id, if any.
   *  Used by the GM to label disconnect status messages with the player's
   *  real name rather than a truncated peer hash. */
  playerForPeer(peerId: string): PersistentPlayer | undefined {
    const clientId = this.clientByPeer.get(peerId);
    return clientId ? this.playerForClient(clientId) : undefined;
  }

  /**
   * Handle an inbound `player_identify`. Upserts the persistent player record
   * (keyed by playerId) and binds the live connection to it. Returns the
   * resulting player so the caller can refresh UI.
   */
  async identify(peerId: string, msg: MsgPlayerIdentify): Promise<PersistentPlayer> {
    const now = Date.now();
    const existing = this.byId.get(msg.playerId);
    const player: PersistentPlayer = existing
      ? { ...existing, playerName: msg.playerName, characterName: msg.characterName, color: msg.color, managedByGm: false, updatedAt: now }
      : { id: msg.playerId, playerName: msg.playerName, characterName: msg.characterName, color: msg.color, createdAt: now, updatedAt: now };
    this.byId.set(player.id, player);
    await savePlayer(player);

    this.bindings.set(msg.clientId, player.id);
    if (peerId && peerId !== 'local') this.clientByPeer.set(peerId, msg.clientId);
    return player;
  }

  /** Clean disconnect from a player window (player_bye). Clears the binding. */
  bye(clientId: string): void {
    this.bindings.delete(clientId);
    for (const [peerId, cid] of this.clientByPeer) {
      if (cid === clientId) this.clientByPeer.delete(peerId);
    }
  }

  /** Transport-level disconnect (PeerJS peer dropped). Clears any binding. */
  disconnectPeer(peerId: string): void {
    const clientId = this.clientByPeer.get(peerId);
    if (clientId) this.bindings.delete(clientId);
    this.clientByPeer.delete(peerId);
  }

  /** GM creates an offline player (someone at the table without a device). */
  async addManaged(playerName: string, characterName: string, color: string): Promise<PersistentPlayer> {
    const now = Date.now();
    const player: PersistentPlayer = {
      id: generateId(),
      playerName, characterName,
      color: normaliseHex(color),
      managedByGm: true,
      createdAt: now, updatedAt: now,
    };
    this.byId.set(player.id, player);
    await savePlayer(player);
    return player;
  }

  /** GM edits an existing player's fields (name / character / colour / icon). */
  async update(
    id: string,
    patch: Partial<Pick<PersistentPlayer, 'playerName' | 'characterName' | 'color' | 'iconAssetId' | 'iconChar' | 'iconDataUrl'>>,
  ): Promise<PersistentPlayer | undefined> {
    const existing = this.byId.get(id);
    if (!existing) return undefined;
    const next: PersistentPlayer = { ...existing, ...patch, updatedAt: Date.now() };
    if (patch.color) next.color = normaliseHex(patch.color);
    this.byId.set(id, next);
    await savePlayer(next);
    return next;
  }

  /** Clear the picked icon — token falls back to the player's initial. */
  async clearIcon(id: string): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;
    const next: PersistentPlayer = { ...existing, updatedAt: Date.now() };
    delete next.iconAssetId;
    delete next.iconChar;
    delete next.iconDataUrl;
    this.byId.set(id, next);
    await savePlayer(next);
  }

  /** Set the token icon — picks one of iconChar / iconDataUrl, clears the other. */
  async setIcon(id: string, opts: { assetId: string; iconChar?: string; iconDataUrl?: string }): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;
    const next: PersistentPlayer = { ...existing, iconAssetId: opts.assetId, updatedAt: Date.now() };
    delete next.iconChar;
    delete next.iconDataUrl;
    if (opts.iconChar)    next.iconChar    = opts.iconChar;
    if (opts.iconDataUrl) next.iconDataUrl = opts.iconDataUrl;
    this.byId.set(id, next);
    await savePlayer(next);
  }

  // ── Player tokens (v2.16.4 player markers) ────────────────────────────────

  /** Whether this player's token is placed on the given map. */
  isPlacedOn(playerId: string, mapId: string): boolean {
    return !!this.byId.get(playerId)?.placements?.[mapId];
  }

  /** Set/move this player's token position on a map (placing it if absent). */
  async setPlacement(playerId: string, mapId: string, x: number, y: number): Promise<void> {
    const p = this.byId.get(playerId);
    if (!p) return;
    const placements = { ...(p.placements ?? {}), [mapId]: { x, y } };
    const next: PersistentPlayer = { ...p, placements, updatedAt: Date.now() };
    this.byId.set(playerId, next);
    await savePlayer(next);
  }

  /** Remove this player's token from a map. */
  async removePlacement(playerId: string, mapId: string): Promise<void> {
    const p = this.byId.get(playerId);
    if (!p?.placements?.[mapId]) return;
    const placements = { ...p.placements };
    delete placements[mapId];
    const next: PersistentPlayer = { ...p, placements, updatedAt: Date.now() };
    this.byId.set(playerId, next);
    await savePlayer(next);
  }

  /** Read a player's token position on a map, or undefined. */
  placementOn(playerId: string, mapId: string): { x: number; y: number } | undefined {
    return this.byId.get(playerId)?.placements?.[mapId];
  }

  /** Render set for a map: every player with a token placed on it. */
  markersForMap(mapId: string): Array<{ playerId: string; name: string; color: string; x: number; y: number; iconChar?: string; iconDataUrl?: string }> {
    const out: Array<{ playerId: string; name: string; color: string; x: number; y: number; iconChar?: string; iconDataUrl?: string }> = [];
    for (const p of this.byId.values()) {
      const pos = p.placements?.[mapId];
      if (!pos) continue;
      out.push({
        playerId: p.id,
        name: p.characterName || p.playerName || 'Player',
        color: p.color,
        x: pos.x, y: pos.y,
        ...(p.iconChar    ? { iconChar:    p.iconChar }    : {}),
        ...(p.iconDataUrl ? { iconDataUrl: p.iconDataUrl } : {}),
      });
    }
    return out;
  }

  /** GM removes a player from the roster entirely. */
  async remove(id: string): Promise<void> {
    this.byId.delete(id);
    for (const [clientId, playerId] of this.bindings) {
      if (playerId === id) this.bindings.delete(clientId);
    }
    await deletePlayer(id);
  }

  /** Roster snapshot broadcast to players (GM-only fields stripped). */
  rosterMessage(): MsgPlayerRoster {
    return {
      type: 'player_roster',
      players: this.all().map((p) => ({
        id: p.id,
        playerName: p.playerName,
        characterName: p.characterName,
        color: p.color,
        connected: this.isConnected(p.id),
      })),
    };
  }
}
