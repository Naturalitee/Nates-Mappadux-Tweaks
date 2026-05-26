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
import { parseSoundtrackUrl, defaultTrackLabel, parseSpotifyUri } from '../stagecraft/soundtrackUrl.ts';
import { migrateSoundtracksConfig, newUserSlot } from '../stagecraft/soundtracksMigrate.ts';

// Lucide-style inline SVGs. Stroke uses currentColor so they pick
// up the button's text colour (active toggles get the accent).
const ICON_PLAY    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE   = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PREV    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M6 6v12h2V6H6zM20 6l-10 6 10 6V6z"/></svg>';
const ICON_NEXT    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M4 6l10 6-10 6V6zM16 6v12h2V6h-2z"/></svg>';
const ICON_LOOP    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
const ICON_SHUFFLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';

/** True if the track is a playlist-style item — the engine iterates
 *  it internally rather than playing one item. Drives whether the
 *  Shuffle toggle is visible / meaningful on the slot. */
function _isPlaylistContent(track: SoundtrackTrack): boolean {
  if (track.kind === 'youtube-playlist') return true;
  if (track.kind === 'spotify') {
    const p = parseSpotifyUri(track.trackUri);
    return !!p && p.kind !== 'track';
  }
  return false;
}

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
  /** RAF / setTimeout handle for the running crossfade so we can
   *  cancel mid-fade if the user picks another slot. */
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Poll handle that refreshes the now-playing chip every second
   *  while something is playing (so YT/Spotify track changes within
   *  a playlist surface in the UI). */
  private nowPlayingTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether the active player is currently paused. Flips the
   *  pause/play transport icon. */
  private isPaused = false;

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
    const isSilent = slot.kind === 'silent';

    // Header — play button + label + (loop/shuffle icons) + remove.
    const header = document.createElement('div');
    header.className = 'soundtrack-slot-header';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn--ghost btn--sm soundtrack-play-btn';
    playBtn.innerHTML = isActive
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'
      : ICON_PLAY;
    playBtn.title = isActive ? 'Currently playing this slot' : 'Crossfade to this slot';
    playBtn.disabled = !isSilent && !slot.track;
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

      // Loop + Shuffle compact icon toggles, only when a track is set.
      if (slot.track) {
        header.appendChild(this._renderIconToggle({
          icon:    ICON_LOOP,
          title:   'Loop',
          active:  !!slot.loop,
          onClick: () => void this._updateSlot(slot.id, { loop: !slot.loop }),
        }));
        if (_isPlaylistContent(slot.track)) {
          header.appendChild(this._renderIconToggle({
            icon:    ICON_SHUFFLE,
            title:   'Shuffle',
            active:  slot.shuffle !== false,
            onClick: () => void this._updateSlot(slot.id, { shuffle: !(slot.shuffle !== false) }),
          }));
        }
      }

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

    if (!slot.track) {
      row.appendChild(this._renderUrlInput(slot));
    } else {
      row.appendChild(this._renderTrackChip(slot, slot.track));
      // Transport (prev / pause / next) — only when slot is actively
      // playing. Single tracks just get pause; playlists get all three.
      if (isActive) row.appendChild(this._renderTransport(slot));
      // Now-playing line — only while active.
      if (isActive) row.appendChild(this._renderNowPlaying(slot));
      // Trim controls — single-track only.
      if (!_isPlaylistContent(slot.track)) row.appendChild(this._renderTimeControls(slot));
    }

    // Volume — always.
    row.appendChild(this._renderVolume(slot));
    return row;
  }

  private _renderIconToggle(opts: {
    icon: string;
    title: string;
    active: boolean;
    onClick: () => void;
  }): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--ghost btn--sm soundtrack-icon-toggle${opts.active ? ' is-active' : ''}`;
    btn.title = opts.title;
    btn.innerHTML = opts.icon;
    btn.addEventListener('click', opts.onClick);
    return btn;
  }

  private _renderTransport(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-transport';
    const isPlaylist = !!slot.track && _isPlaylistContent(slot.track);
    if (isPlaylist) {
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'btn btn--ghost btn--sm';
      prevBtn.title = 'Previous track';
      prevBtn.innerHTML = ICON_PREV;
      prevBtn.addEventListener('click', () => this._transportPrev());
      row.appendChild(prevBtn);
    }
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'btn btn--ghost btn--sm';
    pauseBtn.title = this.isPaused ? 'Resume' : 'Pause';
    pauseBtn.innerHTML = this.isPaused ? ICON_PLAY : ICON_PAUSE;
    pauseBtn.addEventListener('click', () => this._transportTogglePause());
    row.appendChild(pauseBtn);
    if (isPlaylist) {
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'btn btn--ghost btn--sm';
      nextBtn.title = 'Next track';
      nextBtn.innerHTML = ICON_NEXT;
      nextBtn.addEventListener('click', () => this._transportNext());
      row.appendChild(nextBtn);
    }
    return row;
  }

  private _renderNowPlaying(_slot: SoundtrackSlot): HTMLElement {
    const el = document.createElement('div');
    el.className = 'soundtrack-now-playing';
    el.textContent = '…';
    // Element will be live-updated by _pollNowPlaying via this DOM ref.
    el.dataset['nowPlaying'] = '1';
    return el;
  }

  private _transportPrev(): void {
    if (this.activeKind === 'youtube' && this.ytPlayer) this.ytPlayer.previous();
    else if (this.activeKind === 'spotify' && this.spotifyPlayer) void this.spotifyPlayer.previous();
  }

  private _transportNext(): void {
    if (this.activeKind === 'youtube' && this.ytPlayer) this.ytPlayer.next();
    else if (this.activeKind === 'spotify' && this.spotifyPlayer) void this.spotifyPlayer.next();
  }

  private _transportTogglePause(): void {
    const p = this._activePlayer();
    if (!p) return;
    if (this.isPaused) {
      if (this.activeKind === 'spotify') void (p as SpotifySoundtrackPlayer).play();
      else                                (p as YouTubeSoundtrackPlayer).play();
      this.isPaused = false;
    } else {
      if (this.activeKind === 'spotify') void (p as SpotifySoundtrackPlayer).pause();
      else                                (p as YouTubeSoundtrackPlayer).pause();
      this.isPaused = true;
    }
    this._renderSlots();
  }

  /** Provider-aware placeholder so the input only mentions the
   *  enabled providers. */
  private _urlPlaceholder(): string {
    const yt = isYoutubeEnabled();
    const sp = isSpotifyEnabled();
    if (yt && sp) return 'Paste YouTube or Spotify URL';
    if (yt)       return 'Paste YouTube URL';
    if (sp)       return 'Paste Spotify URL';
    return 'No provider enabled — see Settings';
  }

  private _renderUrlInput(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this._urlPlaceholder();
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = 'Add';
    const submit = (): void => {
      const t = parseSoundtrackUrl(input.value);
      if (!t) {
        this.statusEl.textContent = 'Couldn\'t parse a YouTube / Spotify URL from that input.';
        return;
      }
      if ((t.kind === 'youtube' || t.kind === 'youtube-playlist') && !isYoutubeEnabled()) {
        this.statusEl.textContent = 'YouTube is disabled — enable it in Settings → Soundtracks.';
        return;
      }
      if (t.kind === 'spotify' && !isSpotifyEnabled()) {
        this.statusEl.textContent = 'Spotify is disabled — enable it in Settings → Soundtracks.';
        return;
      }
      // Default shuffle ON for playlist content; off for single tracks.
      const shuffleDefault = _isPlaylistContent(t);
      void this._updateSlot(slot.id, _isPlaylistContent(t)
        ? { track: t, shuffle: shuffleDefault }
        : { track: t });
      this.statusEl.textContent = '';
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    row.append(input, addBtn);
    return row;
  }

  private _renderTrackChip(slot: SoundtrackSlot, track: SoundtrackTrack): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'soundtrack-track';
    if (this.activeSlotId === slot.id) wrap.classList.add('is-playing');
    const desc = document.createElement('span');
    desc.className = 'soundtrack-track-label';
    desc.textContent = track.label ?? defaultTrackLabel(track);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--danger btn--sm';
    clearBtn.textContent = '×';
    clearBtn.title = 'Clear this track';
    clearBtn.addEventListener('click', () => {
      // Clear the track. exactOptionalPropertyTypes blocks
      // { track: undefined } so cast the patch shape — the merge
      // strips the key, matching SoundtrackSlot's optional track.
      void this._updateSlot(slot.id, { track: undefined } as unknown as Partial<SoundtrackSlot>);
    });
    wrap.append(desc, clearBtn);
    return wrap;
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
    this.isPaused     = false;

    if (!target || target.kind === 'silent' || !target.track) {
      this._stopNowPlayingPoll();
      this._renderSlots();
      return;
    }

    // Surface any engine-start failure (timeout loading player,
    // missing auth, etc.) in the status line instead of letting
    // the void caller swallow it.
    try {
      await this._playSlotTrack(target, crossfadeMs);
      this._startNowPlayingPoll();
    } catch (e) {
      this._showError((e as Error).message ?? 'Couldn\'t start playback.');
      this.activeSlotId = null;
      this.activeKind   = null;
    }
    this._renderSlots();
  }

  private _startNowPlayingPoll(): void {
    this._stopNowPlayingPoll();
    const tick = (): void => {
      const np = this.activeKind === 'youtube'
        ? this.ytPlayer?.getNowPlaying()
        : this.activeKind === 'spotify'
          ? this.spotifyPlayer?.getNowPlaying()
          : null;
      const el = this.slotsEl.querySelector<HTMLElement>('[data-now-playing="1"]');
      if (el) {
        el.textContent = np?.title
          ? (np.author ? `${np.title} — ${np.author}` : np.title)
          : '…';
      }
    };
    tick();
    this.nowPlayingTimer = setInterval(tick, 1000);
  }

  private _stopNowPlayingPoll(): void {
    if (this.nowPlayingTimer) {
      clearInterval(this.nowPlayingTimer);
      this.nowPlayingTimer = null;
    }
  }

  /** Play the slot's single track / playlist. Volume starts at 0
   *  and ramps to `slot.volume` via the crossfade helper so the
   *  switch from the previous slot is smooth. */
  private async _playSlotTrack(slot: SoundtrackSlot, crossfadeMs: number): Promise<void> {
    const track = slot.track;
    if (!track) return;
    const targetVolume    = slot.volume ?? DEFAULT_VOLUME;
    const playlistContent = _isPlaylistContent(track);
    const loop            = !!slot.loop;
    const shuffle         = slot.shuffle !== false;  // default true

    if (track.kind === 'youtube') {
      // Pass videoId at create time on FIRST init so the IFrame
      // embed loads with real content (empty-embed init can wedge
      // onReady — see youtubePlayer.ts).
      const isFirst = !this.ytPlayer;
      const p = await this._ensureYouTubePlayer(isFirst ? { videoId: track.videoId } : undefined);
      if (!isFirst) p.load(track.videoId, { autoplay: true, volume: 0 });
      else          { p.setVolume(0); p.play(); }
      this.activeKind = 'youtube';
    } else if (track.kind === 'youtube-playlist') {
      const isFirst = !this.ytPlayer;
      const p = await this._ensureYouTubePlayer(isFirst ? { listId: track.listId } : undefined);
      if (!isFirst) {
        p.loadPlaylist(track.listId, {
          autoplay: true,
          volume:   0,
          loop,
          shuffle:  playlistContent && shuffle,
        });
      } else {
        // Player was created with the playlist already queued.
        // Apply loop/shuffle + start playback.
        p.loadPlaylist(track.listId, {
          autoplay: true,
          volume:   0,
          loop,
          shuffle:  playlistContent && shuffle,
        });
      }
      this.activeKind = 'youtube';
    } else {
      const p = await this._ensureSpotifyPlayer();
      const positionMs = slot.startSec ? Math.floor(slot.startSec * 1000) : 0;
      await p.load(track.trackUri, {
        autoplay: true,
        volume:   0,
        repeat:   loop,
        shuffle:  playlistContent && shuffle,
        ...(positionMs ? { positionMs } : {}),
      });
      this.activeKind = 'spotify';
    }
    await this._fade(this.activeKind, 0, targetVolume, crossfadeMs);
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

  private async _ensureYouTubePlayer(initial?: { videoId?: string; listId?: string }): Promise<YouTubeSoundtrackPlayer> {
    if (this.ytPlayer) return this.ytPlayer;
    this.statusEl.textContent = 'Loading YouTube player…';
    this.ytPlayer = await createYouTubePlayer(initial);
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

  /** Track / playlist ended. For playlist content with loop=true,
   *  the engine cycles internally so we never hit this. For
   *  single-track loop, we restart. Otherwise we fall to silent. */
  private _onTrackEnded(): void {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    if (!slot || !slot.track) return;
    const crossfadeMs = this.cfg.crossfadeMs ?? 1500;
    const playlistContent = _isPlaylistContent(slot.track);
    if (!playlistContent && slot.loop) {
      // Single track + loop → replay (respects startSec on Spotify).
      void this._playSlotTrack(slot, 0);
      return;
    }
    // Anything else: stop, fall back to silent anchor.
    void this._selectSlot(this.cfg.slots[0]?.id ?? null);
    void crossfadeMs;
  }

  private _teardownAllPlayers(): void {
    this._stopNowPlayingPoll();
    if (this.ytPlayer)      { try { this.ytPlayer.destroy(); }      catch { /* nothing */ } this.ytPlayer = null; }
    if (this.spotifyPlayer) { try { this.spotifyPlayer.destroy(); } catch { /* nothing */ } this.spotifyPlayer = null; }
    this.activeKind   = null;
    this.activeSlotId = null;
    this.isPaused     = false;
  }
}
