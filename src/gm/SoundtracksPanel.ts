/**
 * SoundtracksPanel — pack-level background music with N user-defined
 * slots, mutually-exclusive playback, and crossfade on slot switch.
 *
 * The first slot is always a "Silent" anchor — selecting it
 * crossfades the current track to silence and stops. Other slots
 * are user-authored, each with:
 *   - label (e.g. "Tavern", "Combat")
 *   - mode: play-once | loop | playlist
 *   - tracks: YouTube and/or Spotify URLs
 *   - per-mode controls: start/end times for play-once/loop, shuffle
 *     for playlist
 *   - per-slot volume
 *
 * One YouTube and one Spotify engine live alongside each other. The
 * crossfade engine ramps the active engine's volume to 0 while
 * ramping the new engine's volume from 0 to the target. Both engines
 * support setVolume (YouTube IFrame Player + Spotify Web Playback
 * SDK), so this works across providers without a parallel-iframe
 * trick.
 *
 * v2.15.12 — N-slot model + Spotify SDK + crossfade.
 */

import type { SoundtracksConfig, SoundtrackSlot, SoundtrackTrack } from '../types.ts';
import {
  isSoundtracksEnabled,
  isYoutubeEnabled,
  isSpotifyEnabled,
} from '../stagecraft/stagecraftStorage.ts';
import {
  createYouTubePlayer,
  YT_STATE,
  type YouTubeSoundtrackPlayer,
} from '../stagecraft/youtubePlayer.ts';
import {
  createSpotifyPlayer,
  type SpotifySoundtrackPlayer,
} from '../stagecraft/spotifySdk.ts';
import { isSpotifyConnected, getSpotifyProfile } from '../stagecraft/spotifyAuth.ts';
import { parseSoundtrackUrl, defaultTrackLabel } from '../stagecraft/soundtrackUrl.ts';
import { migrateSoundtracksConfig, newUserSlot } from '../stagecraft/soundtracksMigrate.ts';

export interface SoundtracksPanelHost {
  /** Returns the current config (legacy-shape allowed; the panel
   *  migrates on first read). */
  getConfig(): SoundtracksConfig;
  saveConfig(cfg: SoundtracksConfig): Promise<void>;
}

const DEFAULT_VOLUME = 80;
const CROSSFADE_STEPS = 20;

export class SoundtracksPanel {
  private host:        SoundtracksPanelHost;
  private panelEl:     HTMLElement;
  private slotsEl:     HTMLElement;
  private statusEl:    HTMLElement;
  /** Migrated working copy of the config. */
  private cfg:         SoundtracksConfig = { slots: [] };
  /** Lazily created engines. */
  private ytPlayer:      YouTubeSoundtrackPlayer | null = null;
  private spotifyPlayer: SpotifySoundtrackPlayer | null = null;
  /** Which provider's engine is currently producing audio. */
  private activeKind:   'youtube' | 'spotify' | null = null;
  /** Which slot is currently playing — id from this.cfg.slots. */
  private activeSlotId: string | null = null;
  /** Index within the active slot's tracks list. */
  private activeIndex = 0;
  /** RAF / setTimeout handle for the running crossfade so we can
   *  cancel mid-fade if the user picks another slot. */
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: SoundtracksPanelHost) {
    this.host     = host;
    this.panelEl  = document.getElementById('soundtracks-panel')!;
    this.slotsEl  = document.getElementById('soundtracks-slots')!;
    this.statusEl = document.getElementById('soundtracks-status')!;
  }

  refresh(): void {
    if (!isSoundtracksEnabled()) {
      this.panelEl.hidden = true;
      this._teardownAllPlayers();
      return;
    }
    this.panelEl.hidden = false;
    this.cfg = migrateSoundtracksConfig(this.host.getConfig());
    this._renderSlots();
  }

  // ─── Render ─────────────────────────────────────────────────────────

  private _renderSlots(): void {
    this.slotsEl.innerHTML = '';
    for (const slot of this.cfg.slots) {
      this.slotsEl.appendChild(this._renderSlotRow(slot));
    }
    // Add-slot button.
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm btn--full';
    addBtn.style.marginTop = '8px';
    addBtn.textContent = '+ Add slot';
    addBtn.addEventListener('click', () => void this._addSlot());
    this.slotsEl.appendChild(addBtn);

    // Spotify status note (helpful when SDK won't play).
    if (isSpotifyEnabled()) {
      const note = document.createElement('div');
      note.className = 'settings-stat-sub';
      note.style.marginTop = '4px';
      if (!isSpotifyConnected()) {
        note.textContent = 'Spotify enabled but not connected — Settings → Stagecraft → Connect to play Spotify tracks.';
      } else {
        const p = getSpotifyProfile();
        if (p && p.product !== 'premium') {
          note.textContent = `Spotify connected as ${p.displayName} (${p.product}). Web Playback SDK requires a Premium account — free accounts can't play full tracks.`;
        }
      }
      this.slotsEl.appendChild(note);
    }
  }

  private _renderSlotRow(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-slot';
    row.dataset['slotId'] = slot.id;
    const isActive = this.activeSlotId === slot.id;
    if (isActive) row.classList.add('is-active');
    const isSilent = slot.mode === 'silent';

    // Header — label + play indicator + (for non-silent) settings popover.
    const header = document.createElement('div');
    header.className = 'soundtrack-slot-header';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn--ghost btn--sm';
    playBtn.textContent = isActive ? '▣' : '▶';
    playBtn.title = isActive ? 'Currently playing' : 'Crossfade to this slot';
    playBtn.disabled = !isSilent && slot.tracks.length === 0;
    playBtn.addEventListener('click', () => void this._selectSlot(slot.id));
    header.appendChild(playBtn);

    if (isSilent) {
      const labelEl = document.createElement('div');
      labelEl.className = 'soundtrack-slot-label';
      labelEl.textContent = slot.label;
      header.appendChild(labelEl);
    } else {
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = slot.label;
      labelInput.className = 'soundtrack-slot-label-input';
      labelInput.addEventListener('change', () => void this._updateSlot(slot.id, { label: labelInput.value.trim() || 'Slot' }));
      header.appendChild(labelInput);
    }

    if (!isSilent) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger btn--sm';
      delBtn.textContent = '×';
      delBtn.title = 'Remove slot';
      delBtn.addEventListener('click', () => void this._removeSlot(slot.id));
      header.appendChild(delBtn);
    }
    row.appendChild(header);

    if (isSilent) return row;

    // Mode picker.
    const modeRow = document.createElement('div');
    modeRow.className = 'soundtrack-mode-row';
    const modeSelect = document.createElement('select');
    for (const m of ['play-once', 'loop', 'playlist'] as const) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m === 'play-once' ? 'Play once' : m === 'loop' ? 'Loop' : 'Playlist';
      modeSelect.appendChild(opt);
    }
    modeSelect.value = slot.mode;
    modeSelect.addEventListener('change', () => void this._updateSlot(slot.id, { mode: modeSelect.value as SoundtrackSlot['mode'] }));
    modeRow.appendChild(modeSelect);
    row.appendChild(modeRow);

    // Mode-specific controls.
    if (slot.mode === 'play-once' || slot.mode === 'loop') {
      row.appendChild(this._renderTimeControls(slot));
    } else if (slot.mode === 'playlist') {
      row.appendChild(this._renderShuffleControl(slot));
    }

    // Tracks list.
    row.appendChild(this._renderTrackList(slot));

    // Add-track input.
    row.appendChild(this._renderAddTrack(slot));

    // Volume slider.
    row.appendChild(this._renderVolume(slot));

    return row;
  }

  private _renderTimeControls(slot: SoundtrackSlot): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'soundtrack-time-row';
    const mkInput = (label: string, key: 'startSec' | 'endSec'): HTMLElement => {
      const lbl = document.createElement('label');
      const val = document.createElement('input');
      val.type = 'number';
      val.min  = '0';
      val.step = '0.5';
      val.placeholder = label === 'Start' ? '0' : '(end)';
      const cur = slot[key];
      val.value = cur !== undefined ? String(cur) : '';
      val.addEventListener('change', () => {
        const num = parseFloat(val.value);
        const patch = Number.isFinite(num) && num >= 0
          ? ({ [key]: num } as Partial<SoundtrackSlot>)
          : ({ [key]: undefined } as unknown as Partial<SoundtrackSlot>);
        void this._updateSlot(slot.id, patch);
      });
      lbl.append(document.createTextNode(label + ' '), val);
      return lbl;
    };
    wrap.append(mkInput('Start', 'startSec'), mkInput('End', 'endSec'));
    return wrap;
  }

  private _renderShuffleControl(slot: SoundtrackSlot): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'soundtrack-shuffle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!slot.shuffle;
    cb.addEventListener('change', () => void this._updateSlot(slot.id, { shuffle: cb.checked }));
    wrap.append(cb, document.createTextNode(' Shuffle (random order)'));
    return wrap;
  }

  private _renderTrackList(slot: SoundtrackSlot): HTMLElement {
    const list = document.createElement('div');
    list.className = 'soundtrack-tracks';
    if (slot.tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-stat-sub';
      empty.textContent = 'No tracks — paste a URL below.';
      list.appendChild(empty);
      return list;
    }
    slot.tracks.forEach((t, i) => {
      const trEl = document.createElement('div');
      trEl.className = 'soundtrack-track';
      if (this.activeSlotId === slot.id && i === this.activeIndex) trEl.classList.add('is-playing');
      const desc = document.createElement('span');
      desc.textContent = t.label ?? defaultTrackLabel(t);
      desc.className   = 'soundtrack-track-label';
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'btn btn--danger btn--sm';
      rmBtn.textContent = '×';
      rmBtn.title = 'Remove track';
      rmBtn.addEventListener('click', () => void this._removeTrack(slot.id, i));
      trEl.append(desc, rmBtn);
      list.appendChild(trEl);
    });
    return list;
  }

  private _renderAddTrack(slot: SoundtrackSlot): HTMLElement {
    const addRow = document.createElement('div');
    addRow.className = 'soundtrack-add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Paste YouTube or Spotify URL';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = 'Add';
    const submit = (): void => {
      const t = parseSoundtrackUrl(input.value);
      if (!t) {
        this.statusEl.textContent = 'Couldn\'t parse a YouTube / Spotify track from that URL.';
        return;
      }
      if (t.kind === 'youtube' && !isYoutubeEnabled()) {
        this.statusEl.textContent = 'YouTube is disabled — enable it in Settings → Stagecraft.';
        return;
      }
      if (t.kind === 'spotify' && !isSpotifyEnabled()) {
        this.statusEl.textContent = 'Spotify is disabled — enable it in Settings → Stagecraft.';
        return;
      }
      void this._addTrack(slot.id, t);
      input.value = '';
      this.statusEl.textContent = '';
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    addRow.append(input, addBtn);
    return addRow;
  }

  private _renderVolume(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-volume-row';
    const label = document.createElement('span');
    label.className = 'settings-stat-sub';
    const initialVol = slot.volume ?? DEFAULT_VOLUME;
    label.textContent = `Vol ${initialVol}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min  = '0';
    slider.max  = '100';
    slider.value = String(initialVol);
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      label.textContent = `Vol ${v}%`;
      // Live-drive the active player's volume if THIS slot is playing.
      if (this.activeSlotId === slot.id) {
        const player = this._activePlayer();
        if (player) {
          if (this.activeKind === 'spotify') void (player as SpotifySoundtrackPlayer).setVolume(v);
          else                                (player as YouTubeSoundtrackPlayer).setVolume(v);
        }
      }
    });
    slider.addEventListener('change', () => {
      const v = parseInt(slider.value, 10);
      void this._updateSlot(slot.id, { volume: v });
    });
    row.append(label, slider);
    return row;
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  private async _addSlot(): Promise<void> {
    const slot = newUserSlot(`Slot ${this.cfg.slots.length}`);
    this.cfg = { ...this.cfg, slots: [...this.cfg.slots, slot] };
    await this.host.saveConfig(this.cfg);
    this._renderSlots();
  }

  private async _removeSlot(id: string): Promise<void> {
    if (this.activeSlotId === id) await this._selectSlot(this.cfg.slots[0]?.id ?? null);
    this.cfg = { ...this.cfg, slots: this.cfg.slots.filter((s) => s.id !== id) };
    await this.host.saveConfig(this.cfg);
    this._renderSlots();
  }

  private async _updateSlot(id: string, patch: Partial<SoundtrackSlot>): Promise<void> {
    this.cfg = {
      ...this.cfg,
      slots: this.cfg.slots.map((s) => s.id === id ? { ...s, ...patch } : s),
    };
    await this.host.saveConfig(this.cfg);
    this._renderSlots();
  }

  private async _addTrack(id: string, track: SoundtrackTrack): Promise<void> {
    const slot = this.cfg.slots.find((s) => s.id === id);
    if (!slot) return;
    await this._updateSlot(id, { tracks: [...slot.tracks, track] });
  }

  private async _removeTrack(id: string, index: number): Promise<void> {
    const slot = this.cfg.slots.find((s) => s.id === id);
    if (!slot) return;
    await this._updateSlot(id, { tracks: slot.tracks.filter((_, i) => i !== index) });
  }

  // ─── Playback ───────────────────────────────────────────────────────

  /** Crossfade from the currently-playing slot to `targetSlotId`.
   *  Silent target: fade current down + stop. Same-slot: no-op. */
  private async _selectSlot(targetSlotId: string | null): Promise<void> {
    if (targetSlotId === this.activeSlotId) return;
    const target = targetSlotId ? this.cfg.slots.find((s) => s.id === targetSlotId) : null;
    const crossfadeMs = this.cfg.crossfadeMs ?? 1500;

    // Cancel any in-flight crossfade.
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null; }

    // Fade current down (if anything is playing).
    if (this.activeKind && this._activePlayer()) {
      await this._fade(this.activeKind, this._currentVolume(), 0, crossfadeMs);
      try {
        const p = this._activePlayer();
        if (this.activeKind === 'spotify') await (p as SpotifySoundtrackPlayer).stop();
        else                                (p as YouTubeSoundtrackPlayer).stop();
      } catch { /* nothing */ }
    }

    this.activeSlotId = targetSlotId;
    this.activeKind   = null;
    this.activeIndex  = 0;

    if (!target || target.mode === 'silent' || target.tracks.length === 0) {
      this._renderSlots();
      return;
    }

    // Pick the first track (or random if shuffle), kick playback.
    const startIndex = target.mode === 'playlist' && target.shuffle
      ? Math.floor(Math.random() * target.tracks.length)
      : 0;
    this.activeIndex = startIndex;
    await this._playTrackAtIndex(target, startIndex, crossfadeMs);
    this._renderSlots();
  }

  private async _playTrackAtIndex(slot: SoundtrackSlot, index: number, crossfadeMs: number): Promise<void> {
    const track = slot.tracks[index];
    if (!track) return;
    const targetVolume = slot.volume ?? DEFAULT_VOLUME;
    if (track.kind === 'youtube') {
      const p = await this._ensureYouTubePlayer();
      p.load(track.videoId, { autoplay: true, volume: 0 });
      this.activeKind = 'youtube';
      await this._fade('youtube', 0, targetVolume, crossfadeMs);
    } else if (track.kind === 'youtube-playlist') {
      const p = await this._ensureYouTubePlayer();
      // The IFrame iterates the playlist internally. Slot mode maps
      // onto the IFrame's loop flag: 'loop' / 'playlist' loop the
      // whole list; 'play-once' lets the list play once and stop.
      p.loadPlaylist(track.listId, {
        autoplay: true,
        volume:   0,
        loop:     slot.mode === 'loop' || slot.mode === 'playlist',
        shuffle:  !!slot.shuffle,
      });
      this.activeKind = 'youtube';
      await this._fade('youtube', 0, targetVolume, crossfadeMs);
    } else {
      const p = await this._ensureSpotifyPlayer();
      const positionMs = slot.startSec ? Math.floor(slot.startSec * 1000) : 0;
      // Mirror the YT-playlist behaviour: slot mode + shuffle become
      // Spotify's repeat-context + shuffle state. Only meaningful
      // for context URIs (playlist / album / show) — the SDK ignores
      // these on a single-track URI.
      await p.load(track.trackUri, {
        autoplay: true,
        volume:   0,
        repeat:   slot.mode === 'loop' || slot.mode === 'playlist',
        shuffle:  !!slot.shuffle,
        ...(positionMs ? { positionMs } : {}),
      });
      this.activeKind = 'spotify';
      await this._fade('spotify', 0, targetVolume, crossfadeMs);
    }
  }

  /** Volume ramp on the named engine. Returns when the fade is done
   *  (or has been cancelled by a newer _selectSlot). */
  private async _fade(kind: 'youtube' | 'spotify', from: number, to: number, durationMs: number): Promise<void> {
    if (durationMs <= 0) return;
    const stepMs = Math.max(20, Math.floor(durationMs / CROSSFADE_STEPS));
    const steps  = Math.max(1, Math.floor(durationMs / stepMs));
    return new Promise((resolve) => {
      let i = 0;
      const tick = (): void => {
        i++;
        const t = Math.min(1, i / steps);
        const v = from + (to - from) * t;
        const p = kind === 'youtube' ? this.ytPlayer : this.spotifyPlayer;
        if (p) {
          if (kind === 'spotify') void (p as SpotifySoundtrackPlayer).setVolume(v);
          else                    (p as YouTubeSoundtrackPlayer).setVolume(v);
        }
        if (i >= steps) { this.crossfadeTimer = null; resolve(); }
        else            { this.crossfadeTimer = setTimeout(tick, stepMs); }
      };
      this.crossfadeTimer = setTimeout(tick, stepMs);
    });
  }

  private _currentVolume(): number {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    return slot?.volume ?? DEFAULT_VOLUME;
  }

  private _activePlayer(): YouTubeSoundtrackPlayer | SpotifySoundtrackPlayer | null {
    if (this.activeKind === 'youtube') return this.ytPlayer;
    if (this.activeKind === 'spotify') return this.spotifyPlayer;
    return null;
  }

  private async _ensureYouTubePlayer(): Promise<YouTubeSoundtrackPlayer> {
    if (this.ytPlayer) return this.ytPlayer;
    this.statusEl.textContent = 'Loading YouTube player…';
    this.ytPlayer = await createYouTubePlayer();
    this.statusEl.textContent = '';
    this.ytPlayer.onStateChange((s) => {
      if (s === YT_STATE.ENDED) this._onTrackEnded();
    });
    this.ytPlayer.onError((_code, message) => this._showError(message));
    return this.ytPlayer;
  }

  private async _ensureSpotifyPlayer(): Promise<SpotifySoundtrackPlayer> {
    if (this.spotifyPlayer) return this.spotifyPlayer;
    if (!isSpotifyConnected()) {
      throw new Error('Spotify not connected. Settings → Soundtracks → Connect Spotify.');
    }
    this.statusEl.textContent = 'Loading Spotify player…';
    this.spotifyPlayer = await createSpotifyPlayer();
    this.statusEl.textContent = '';
    this.spotifyPlayer.onEnded(() => this._onTrackEnded());
    this.spotifyPlayer.onError((_kind, message) => this._showError(message));
    return this.spotifyPlayer;
  }

  /** Surface a player error in the status line + give the engine a
   *  beat to recover. Errors from YT IFrame or the Spotify SDK both
   *  funnel through here so the user sees one consistent place for
   *  troubleshooting hints. Clears after 8 s so it doesn't linger. */
  private _showError(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.add('soundtrack-status--error');
    setTimeout(() => {
      if (this.statusEl.textContent === message) {
        this.statusEl.textContent = '';
        this.statusEl.classList.remove('soundtrack-status--error');
      }
    }, 8000);
  }

  private _onTrackEnded(): void {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    if (!slot) return;
    const crossfadeMs = this.cfg.crossfadeMs ?? 1500;
    if (slot.mode === 'play-once') {
      // Stop after one play; go silent.
      void this._selectSlot(this.cfg.slots[0]?.id ?? null);
      return;
    }
    if (slot.mode === 'loop') {
      // Replay the same track from startSec.
      void this._playTrackAtIndex(slot, this.activeIndex, crossfadeMs);
      return;
    }
    // playlist: advance to next track (with shuffle if set).
    let next = this.activeIndex + 1;
    if (slot.shuffle && slot.tracks.length > 1) {
      do { next = Math.floor(Math.random() * slot.tracks.length); }
      while (next === this.activeIndex);
    }
    if (next >= slot.tracks.length) next = 0;
    this.activeIndex = next;
    void this._playTrackAtIndex(slot, next, crossfadeMs);
    this._renderSlots();
  }

  private _teardownAllPlayers(): void {
    if (this.ytPlayer)      { try { this.ytPlayer.destroy(); }      catch { /* nothing */ } this.ytPlayer = null; }
    if (this.spotifyPlayer) { try { this.spotifyPlayer.destroy(); } catch { /* nothing */ } this.spotifyPlayer = null; }
    this.activeKind   = null;
    this.activeSlotId = null;
    this.activeIndex  = 0;
  }
}
