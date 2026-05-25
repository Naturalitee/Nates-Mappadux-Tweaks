/**
 * SoundtracksPanel — pack-level background music. v2.16 first cut.
 *
 * Four slots: Pre-setup / Theme (Intro) / Outro / Playlist. Each slot
 * holds a list of YouTube URL references. The panel uses one shared
 * YouTube IFrame Player instance and multiplexes it onto whichever
 * slot the GM is currently playing.
 *
 * No OAuth — YouTube IFrame works for anyone. Spotify Web Playback
 * SDK lands in a later patch behind a discriminated union on
 * `SoundtrackTrack.kind`.
 *
 * Hidden by default; appears once isSoundtracksEnabled() is true
 * (Settings toggle).
 */

import type { SoundtracksConfig, SoundtrackSlot, SoundtrackTrack } from '../types.ts';
import { isSoundtracksEnabled } from '../stagecraft/stagecraftStorage.ts';
import {
  createYouTubePlayer,
  extractVideoId,
  YT_STATE,
  type YouTubeSoundtrackPlayer,
} from '../stagecraft/youtubePlayer.ts';

type SlotKey = 'preSetup' | 'theme' | 'outro' | 'playlist';

const SLOT_ORDER: { key: SlotKey; label: string }[] = [
  { key: 'preSetup', label: 'Pre-setup' },
  { key: 'theme',    label: 'Theme / Intro' },
  { key: 'outro',    label: 'Outro' },
  { key: 'playlist', label: 'Playlist' },
];

export interface SoundtracksPanelHost {
  /** Read the current pack-level Soundtracks config. Returns an empty
   *  object when nothing has been set yet. */
  getConfig(): SoundtracksConfig;
  /** Persist the new config. Called whenever the GM adds / removes a
   *  track or changes a slot's volume. */
  saveConfig(cfg: SoundtracksConfig): Promise<void>;
}

export class SoundtracksPanel {
  private host:        SoundtracksPanelHost;
  private panelEl:     HTMLElement;
  private slotsEl:     HTMLElement;
  private statusEl:    HTMLElement;
  private player:      YouTubeSoundtrackPlayer | null = null;
  /** Which slot is currently playing — null = nothing. */
  private activeSlot:  SlotKey | null = null;
  /** Index within the active slot's tracks list. */
  private activeIndex = 0;

  constructor(host: SoundtracksPanelHost) {
    this.host     = host;
    this.panelEl  = document.getElementById('soundtracks-panel')!;
    this.slotsEl  = document.getElementById('soundtracks-slots')!;
    this.statusEl = document.getElementById('soundtracks-status')!;
    // Panel collapse/expand is handled by GMApp's global panel-title
    // listener (binds every .panel-title[aria-expanded] button at
    // bindUIControls time).
  }

  /** Show / hide the panel based on Settings toggle + rebuild the
   *  slot rows. Called from init() + on every Settings close. */
  refresh(): void {
    if (!isSoundtracksEnabled()) {
      this.panelEl.hidden = true;
      // Don't tear down a playing track silently — if the user has it
      // running, they'll notice the panel disappear; they can re-enable.
      this._teardownPlayer();
      return;
    }
    this.panelEl.hidden = false;
    this._renderSlots();
  }

  private _renderSlots(): void {
    const cfg = this.host.getConfig();
    this.slotsEl.innerHTML = '';
    for (const { key, label } of SLOT_ORDER) {
      const slot = cfg[key];
      this.slotsEl.appendChild(this._renderSlotRow(key, label, slot));
    }
  }

  private _renderSlotRow(key: SlotKey, label: string, slot: SoundtrackSlot | undefined): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-slot';
    row.dataset['slotKey'] = key;

    // Header — label + transport buttons.
    const header = document.createElement('div');
    header.className = 'soundtrack-slot-header';
    const labelEl = document.createElement('div');
    labelEl.className = 'soundtrack-slot-label';
    labelEl.textContent = label;
    header.appendChild(labelEl);

    const isActive = this.activeSlot === key;
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn--ghost btn--sm';
    playBtn.textContent = isActive ? 'Pause' : 'Play';
    playBtn.disabled = !slot || slot.tracks.length === 0;
    playBtn.addEventListener('click', () => {
      if (isActive) void this._togglePause();
      else          void this._playSlot(key);
    });

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'btn btn--ghost btn--sm';
    stopBtn.textContent = 'Stop';
    stopBtn.disabled = !isActive;
    stopBtn.addEventListener('click', () => this._stop());

    header.append(playBtn, stopBtn);
    row.appendChild(header);

    // Volume slider (drives the YT player when this slot is active).
    const volRow = document.createElement('div');
    volRow.className = 'soundtrack-volume-row';
    const volLabel = document.createElement('span');
    volLabel.className = 'settings-stat-sub';
    const initialVol = slot?.volume ?? 80;
    volLabel.textContent = `Vol ${initialVol}%`;
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = String(initialVol);
    volSlider.addEventListener('input', () => {
      const v = parseInt(volSlider.value, 10);
      volLabel.textContent = `Vol ${v}%`;
      if (isActive && this.player) this.player.setVolume(v);
    });
    volSlider.addEventListener('change', () => {
      const v = parseInt(volSlider.value, 10);
      void this._setSlotVolume(key, v);
    });
    volRow.append(volLabel, volSlider);
    row.appendChild(volRow);

    // Track list.
    const tracksEl = document.createElement('div');
    tracksEl.className = 'soundtrack-tracks';
    if (slot && slot.tracks.length > 0) {
      slot.tracks.forEach((t, i) => {
        const trEl = document.createElement('div');
        trEl.className = 'soundtrack-track';
        if (isActive && i === this.activeIndex) trEl.classList.add('is-playing');
        const desc = document.createElement('span');
        desc.textContent = t.kind === 'youtube'
          ? (t.label ?? `YouTube: ${t.videoId}`)
          : (t.label ?? `Spotify: ${t.trackUri}`);
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'btn btn--danger btn--sm';
        rmBtn.textContent = '×';
        rmBtn.title = 'Remove track';
        rmBtn.addEventListener('click', () => void this._removeTrack(key, i));
        trEl.append(desc, rmBtn);
        tracksEl.appendChild(trEl);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'settings-stat-sub';
      empty.textContent = 'No tracks. Paste a YouTube URL below to add one.';
      tracksEl.appendChild(empty);
    }
    row.appendChild(tracksEl);

    // Add-track input.
    const addRow = document.createElement('div');
    addRow.className = 'soundtrack-add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Paste YouTube URL (or video id)';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = 'Add';
    const submit = () => {
      const id = extractVideoId(input.value);
      if (!id) {
        this.statusEl.textContent = 'Could not parse a YouTube video id from that input.';
        return;
      }
      void this._addTrack(key, { kind: 'youtube', videoId: id });
      input.value = '';
      this.statusEl.textContent = '';
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });
    addRow.append(input, addBtn);
    row.appendChild(addRow);

    return row;
  }

  private async _addTrack(key: SlotKey, track: SoundtrackTrack): Promise<void> {
    const cfg = this.host.getConfig();
    const slot = cfg[key] ?? { tracks: [] };
    const next: SoundtracksConfig = {
      ...cfg,
      [key]: { ...slot, tracks: [...slot.tracks, track] },
    };
    await this.host.saveConfig(next);
    this._renderSlots();
  }

  private async _setSlotVolume(key: SlotKey, volume: number): Promise<void> {
    const cfg = this.host.getConfig();
    const slot = cfg[key] ?? { tracks: [] };
    const next: SoundtracksConfig = {
      ...cfg,
      [key]: { ...slot, volume },
    };
    await this.host.saveConfig(next);
  }

  private async _removeTrack(key: SlotKey, index: number): Promise<void> {
    const cfg = this.host.getConfig();
    const slot = cfg[key];
    if (!slot) return;
    const nextTracks = slot.tracks.filter((_, i) => i !== index);
    const next: SoundtracksConfig = {
      ...cfg,
      [key]: { ...slot, tracks: nextTracks },
    };
    // If we just removed the active track, stop.
    if (this.activeSlot === key && this.activeIndex >= nextTracks.length) {
      this._stop();
    }
    await this.host.saveConfig(next);
    this._renderSlots();
  }

  private async _playSlot(key: SlotKey): Promise<void> {
    const cfg = this.host.getConfig();
    const slot = cfg[key];
    if (!slot || slot.tracks.length === 0) return;
    if (!this.player) {
      this.statusEl.textContent = 'Loading YouTube player…';
      this.player = await createYouTubePlayer();
      this.player.onStateChange((s) => this._onPlayerState(s));
      this.statusEl.textContent = '';
    }
    this.activeSlot  = key;
    this.activeIndex = 0;
    const first = slot.tracks[0];
    if (first && first.kind === 'youtube') {
      this.player.load(first.videoId, {
        autoplay: true,
        volume:   slot.volume ?? 80,
      });
    }
    this._renderSlots();
  }

  private _onPlayerState(state: number): void {
    if (state === YT_STATE.ENDED) {
      // Advance to next track in the active slot, or stop.
      if (!this.activeSlot) return;
      const cfg = this.host.getConfig();
      const slot = cfg[this.activeSlot];
      if (!slot) { this._stop(); return; }
      const next = this.activeIndex + 1;
      if (next >= slot.tracks.length) {
        // Loop playlists; stop one-shots.
        if (this.activeSlot === 'playlist') {
          this.activeIndex = 0;
        } else {
          this._stop();
          return;
        }
      } else {
        this.activeIndex = next;
      }
      const t = slot.tracks[this.activeIndex];
      if (this.player && t && t.kind === 'youtube') {
        this.player.load(t.videoId, { autoplay: true, volume: slot.volume ?? 80 });
      }
      this._renderSlots();
    }
  }

  private _togglePause(): void {
    if (!this.player) return;
    // Crude — assumes any non-paused state means "playing-ish".
    this.player.pause();
  }

  private _stop(): void {
    if (this.player) this.player.stop();
    this.activeSlot  = null;
    this.activeIndex = 0;
    this._renderSlots();
  }

  private _teardownPlayer(): void {
    if (this.player) {
      try { this.player.destroy(); } catch { /* ignore */ }
      this.player = null;
    }
    this.activeSlot  = null;
    this.activeIndex = 0;
  }

}
