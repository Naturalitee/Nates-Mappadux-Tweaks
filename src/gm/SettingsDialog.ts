import {
  getStoredApiKeys,
  deleteAllApiKeys,
  isVideoCap1080Enabled,
  setVideoCap1080Enabled,
  isLocalPlayerStaticOnly,
  setLocalPlayerStaticOnly,
  isScaledViewTransitionsEnabled,
  setScaledViewTransitionsEnabled,
  getUiScale,
  setUiScale,
  applyUiScale,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_DEFAULT,
  type StoredApiKey,
} from '../storage/localSettings.ts';
import {
  getWledEndpoints,
  addWledEndpoint,
  removeWledEndpoint,
  getHaConfig,
  setHaConfig,
  isSoundtracksEnabled,
  setSoundtracksEnabled,
} from '../stagecraft/stagecraftStorage.ts';
import { fetchInfo as fetchWledInfo, normaliseEndpoint } from '../stagecraft/wledClient.ts';
import { generateId } from '../utils/id.ts';

/**
 * Settings dialog. Houses:
 *   • Storage — IndexedDB usage / quota readout, persistence request.
 *   • API Keys — list of stored browser credentials with bulk delete.
 *   • Danger Zone — Delete DB (keep settings) / Delete All Data (wipe).
 *
 * Reads everything live each time it opens — there's nothing persisted by
 * the dialog itself. Destructive actions are handled by the caller via the
 * callbacks; the dialog just confirms intent.
 */
export interface SettingsDialogCallbacks {
  onDeleteDb:        () => Promise<void> | void;
  onDeleteAllData:   () => Promise<void> | void;
}

export class SettingsDialog {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve();
  };

  open(cb: SettingsDialogCallbacks): Promise<void> {
    this.overlay = this._build(cb);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.();
    this.resolver = null;
  }

  private _build(cb: SettingsDialogCallbacks): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Close / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.style.width = '560px';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Settings';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve());
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'settings-body';
    dialog.appendChild(body);

    // ── Storage section ──────────────────────────────────────────────────
    body.appendChild(this._buildStorageSection());
    // ── Display section ──────────────────────────────────────────────────
    body.appendChild(this._buildDisplaySection());
    // ── Scaled View section ──────────────────────────────────────────────
    body.appendChild(this._buildScaledViewSection());
    // ── Performance section ──────────────────────────────────────────────
    body.appendChild(this._buildPerformanceSection());
    // ── Stagecraft section (v2.16) ───────────────────────────────────────
    body.appendChild(this._buildStagecraftSection());
    // ── API Keys section ─────────────────────────────────────────────────
    body.appendChild(this._buildApiKeysSection());
    // ── Danger Zone ──────────────────────────────────────────────────────
    body.appendChild(this._buildDangerZone(cb));

    // Footer — single Close button
    const footer = document.createElement('div');
    footer.className = 'about-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this._resolve());
    footer.appendChild(closeBtn);
    dialog.appendChild(footer);

    return overlay;
  }

  // ─── Storage ────────────────────────────────────────────────────────────

  private _buildStorageSection(): HTMLElement {
    const sec = mkSection('Storage', 'How much of your browser’s allowance Mappadux is using. The quota is set by the browser — you can’t override it, but you can ask for persistence so the browser doesn’t evict your data under pressure.', { open: true });

    const usageLine = document.createElement('div');
    usageLine.className = 'settings-stat';
    usageLine.textContent = 'Reading…';
    sec.appendChild(usageLine);

    const persistLine = document.createElement('div');
    persistLine.className = 'settings-stat';
    persistLine.textContent = 'Persistence: …';
    sec.appendChild(persistLine);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    const persistBtn = document.createElement('button');
    persistBtn.type = 'button';
    persistBtn.className = 'btn btn--ghost btn--sm';
    persistBtn.textContent = 'Request persistent storage';
    persistBtn.addEventListener('click', async () => {
      if (!navigator.storage?.persist) {
        persistLine.textContent = 'Persistence: not supported in this browser.';
        return;
      }
      const ok = await navigator.storage.persist();
      persistLine.textContent = ok
        ? 'Persistence: enabled. Mappadux data is protected from eviction.'
        : 'Persistence: not granted. Try again after user activity, or rely on the standard quota.';
      persistBtn.hidden = ok;
    });
    btnRow.appendChild(persistBtn);
    sec.appendChild(btnRow);

    // Populate async — estimate + persisted are both Promises.
    void this._refreshStorageStats(usageLine, persistLine, persistBtn);

    return sec;
  }

  private async _refreshStorageStats(
    usageLine: HTMLElement,
    persistLine: HTMLElement,
    persistBtn: HTMLButtonElement,
  ): Promise<void> {
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 0;
        const pct   = quota > 0 ? (usage / quota * 100).toFixed(1) : '?';
        usageLine.innerHTML = `Using <strong>${formatBytes(usage)}</strong> of <strong>${formatBytes(quota)}</strong> (${pct}%)`;
      } catch {
        usageLine.textContent = 'Storage usage unavailable in this browser.';
      }
    } else {
      usageLine.textContent = 'Storage usage unavailable in this browser.';
    }

    if (navigator.storage?.persisted) {
      try {
        const persisted = await navigator.storage.persisted();
        persistLine.textContent = persisted
          ? 'Persistence: enabled. Mappadux data is protected from eviction.'
          : 'Persistence: not granted. The browser may evict data if it runs low on space.';
        persistBtn.hidden = persisted;
      } catch {
        persistLine.textContent = 'Persistence: status unavailable.';
      }
    } else {
      persistLine.textContent = 'Persistence: not supported in this browser.';
      persistBtn.hidden = true;
    }
  }

  // ─── API Keys ───────────────────────────────────────────────────────────

  private _buildApiKeysSection(): HTMLElement {
    const sec = mkSection('API Keys (this browser only)', 'Credentials stored locally for external services. These never leave this browser — not even inside Map Pack exports.');

    const keys = getStoredApiKeys();
    if (keys.length === 0) {
      const none = document.createElement('div');
      none.className = 'settings-stat';
      none.style.fontStyle = 'italic';
      none.textContent = 'No API keys stored.';
      sec.appendChild(none);
    } else {
      const list = document.createElement('ul');
      list.className = 'settings-key-list';
      for (const k of keys) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = k.label;
        const preview = document.createElement('span');
        preview.className = 'settings-key-preview';
        preview.textContent = k.preview;
        li.append(label, preview);
        list.appendChild(li);
      }
      sec.appendChild(list);

      const btnRow = document.createElement('div');
      btnRow.className = 'settings-btn-row';
      const deleteAll = document.createElement('button');
      deleteAll.type = 'button';
      deleteAll.className = 'btn btn--danger btn--sm';
      deleteAll.textContent = `Delete ${keys.length === 1 ? 'this key' : 'all API keys'}`;
      deleteAll.addEventListener('click', () => {
        const ok = confirm(
          `Delete ${keys.length === 1 ? 'this API key' : 'all stored API keys'}?\n\n` +
          `External services using these credentials will stop working until you re-enter them.`,
        );
        if (!ok) return;
        deleteAllApiKeys();
        // Re-render this section in place.
        const next = this._buildApiKeysSection();
        sec.replaceWith(next);
      });
      btnRow.appendChild(deleteAll);
      sec.appendChild(btnRow);
    }

    return sec;
  }

  // ─── Display ────────────────────────────────────────────────────────────

  /** UI scale slider. Drives CSS `zoom` on #sidebar so the whole left
   *  panel — fonts, padding, borders, icons, popovers — scales as one
   *  unit. The map canvas + screen-space marker overlay are untouched.
   *  Persists immediately on drag; double-click resets to 100%. */
  private _buildDisplaySection(): HTMLElement {
    const sec = mkSection(
      'Display',
      'How the left-hand panel renders. The map canvas itself is unaffected.',
    );

    const row = document.createElement('div');
    row.className = 'settings-danger-row';

    const label = document.createElement('div');
    const cur = Math.round(getUiScale() * 100);
    const valueEl = document.createElement('strong');
    valueEl.textContent = `UI scale — ${cur}%`;
    label.appendChild(valueEl);
    label.appendChild(document.createElement('br'));
    const help = document.createElement('span');
    help.className = 'settings-stat-sub';
    help.textContent =
      `Shrink or grow the whole sidebar in proportion. Useful on very ` +
      `high-DPI screens where the default reads tiny, or on small ` +
      `laptops where shrinking buys back canvas space. Range ` +
      `${Math.round(UI_SCALE_MIN * 100)}–${Math.round(UI_SCALE_MAX * 100)}%. ` +
      `Double-click the slider to reset to ${Math.round(UI_SCALE_DEFAULT * 100)}%.`;
    label.appendChild(help);

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(UI_SCALE_MIN);
    slider.max   = String(UI_SCALE_MAX);
    slider.step  = '0.05';
    slider.value = String(getUiScale());
    slider.style.width = '120px';
    slider.style.flex  = '0 0 auto';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      setUiScale(v);
      applyUiScale(v);
      valueEl.textContent = `UI scale — ${Math.round(v * 100)}%`;
    });
    slider.addEventListener('dblclick', () => {
      slider.value = String(UI_SCALE_DEFAULT);
      setUiScale(UI_SCALE_DEFAULT);
      applyUiScale(UI_SCALE_DEFAULT);
      valueEl.textContent = `UI scale — ${Math.round(UI_SCALE_DEFAULT * 100)}%`;
    });

    row.append(label, slider);
    sec.appendChild(row);
    return sec;
  }

  // ─── Scaled View ────────────────────────────────────────────────────────

  private _buildScaledViewSection(): HTMLElement {
    const sec = mkSection(
      'Scaled View',
      'Settings apply on next Scaled View open.',
    );

    sec.appendChild(this._buildPerfToggle({
      title: 'Enable transitions & animations',
      help:
        'Off by default — Scaled View cuts instantly to each new frame so a physical table screen never visibly shudders. Tick to enable map-change transitions + handout reveals (good for cinematic table screens; can feel jarring on bare battlemaps).',
      get: isScaledViewTransitionsEnabled,
      set: setScaledViewTransitionsEnabled,
    }));

    return sec;
  }

  // ─── Performance ────────────────────────────────────────────────────────

  private _buildPerformanceSection(): HTMLElement {
    const sec = mkSection(
      'Performance',
      'Trade-offs for animated-map playback. Default values work fine on capable hardware (modern GPUs, decent-resolution sources); flip these on if you hit stalls or stutter.',
    );

    sec.appendChild(this._buildPerfToggle({
      title: 'Send only the first frame to local player windows',
      help:
        'When the GM\'s own PC is also running a player window (the "Open Player Window" popup) or a same-machine projector window, both compete with the GM canvas for Chrome\'s per-window video decoder budget. With this on, the GM doesn\'t send the full video bytes to same-browser peers — they show the first frame as a static map. ' +
        'The projector window keeps trying to animate regardless. Remote players (phones, separate laptops on the LAN) always get full animation; their browser has its own decode budget.<br><br>' +
        '<em>When to enable:</em> 4K (or larger) animated maps + GM popup-player on the same machine + visible stalling. <em>Leave off for:</em> lower-resolution animated maps that play fine in popups, or when no local player windows are open.',
      get: isLocalPlayerStaticOnly,
      set: setLocalPlayerStaticOnly,
    }));

    sec.appendChild(this._buildPerfToggle({
      title: 'Cap animated map texture at 1080p',
      help:
        'Animated-map texture uploads are sized to the WebGL canvas by default — so a fullscreen 4K player on a 4K display uploads 4K every frame. On lower-end GPUs that saturates the upload budget and playback stalls. ' +
        'Tick this to cap the texture at 1920 px on the longest side regardless of window size: looks slightly softer when zoomed in, plays smoothly even on modest hardware.<br><br>' +
        '<em>When to enable:</em> remote players reporting stutter on animated maps even when fullscreen. <em>Leave off for:</em> capable GPUs where the difference is noticeable.',
      get: isVideoCap1080Enabled,
      set: setVideoCap1080Enabled,
    }));

    return sec;
  }

  /** Build one row in the Performance section — title + multi-line
   *  help text + a right-aligned toggle that mirrors a localStorage
   *  flag via the supplied get/set pair. */
  private _buildPerfToggle(opts: {
    title: string;
    help:  string;
    get:   () => boolean;
    set:   (v: boolean) => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    const label = document.createElement('div');
    label.innerHTML =
      `<strong>${opts.title}</strong><br>` +
      `<span class="settings-stat-sub">${opts.help}</span>`;
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = opts.get();
    input.addEventListener('change', () => opts.set(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);
    row.append(label, toggle);
    return row;
  }

  // ─── Danger Zone ────────────────────────────────────────────────────────

  private _buildDangerZone(cb: SettingsDialogCallbacks): HTMLElement {
    const sec = mkSection('Danger Zone', 'Destructive actions. Make sure you have a Map Pack saved first if you want to keep anything.');
    sec.classList.add('settings-danger');

    const row1 = document.createElement('div');
    row1.className = 'settings-danger-row';
    const row1Text = document.createElement('div');
    row1Text.innerHTML =
      '<strong>Delete database</strong><br>' +
      '<span class="settings-stat-sub">Wipes maps, audio, icons, and all pack settings. Keeps API keys, projector calibration, and other browser preferences.</span>';
    const row1Btn = document.createElement('button');
    row1Btn.type = 'button';
    row1Btn.className = 'btn btn--danger btn--sm';
    row1Btn.textContent = 'Delete DB';
    row1Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete database?\n\n' +
        'This wipes ALL maps, sounds, custom icons, and pack settings. ' +
        'Your API keys and projector calibration stay. The page will reload into an empty workspace.',
      );
      if (!ok) return;
      await cb.onDeleteDb();
    });
    row1.append(row1Text, row1Btn);
    sec.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'settings-danger-row';
    const row2Text = document.createElement('div');
    row2Text.innerHTML =
      '<strong>Delete everything</strong><br>' +
      '<span class="settings-stat-sub">Wipes the database AND all local browser settings, including API keys and projector calibration. Acts like a fresh install.</span>';
    const row2Btn = document.createElement('button');
    row2Btn.type = 'button';
    row2Btn.className = 'btn btn--danger btn--sm';
    row2Btn.textContent = 'Delete All Data';
    row2Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete EVERYTHING?\n\n' +
        'This wipes the database AND every local setting Mappadux has stored ' +
        '(API keys, projector calibration, UI preferences). The page will reload as if freshly installed.\n\n' +
        'This cannot be undone.',
      );
      if (!ok) return;
      await cb.onDeleteAllData();
    });
    row2.append(row2Text, row2Btn);
    sec.appendChild(row2);

    return sec;
  }

  // ─── Stagecraft (v2.16) ─────────────────────────────────────────────────

  /** Stagecraft section — connection config for WLED LED strips and
   *  Home Assistant. Setting up any connection here is what makes the
   *  Lighting/Automation panel appear in the main sidebar. Users who
   *  don't use these features see zero extra chrome anywhere. */
  private _buildStagecraftSection(): HTMLElement {
    const sec = mkSection(
      'Stagecraft (Lighting + Automation)',
      'Connect Mappadux to physical lighting (WLED) and home-automation systems (Home Assistant) so a map switch can fire LED presets and scenes at the table. Mappadux only references presets/scenes you have already authored in those tools — set them up there first, then point Mappadux at the device and pick from the dropdown when assigning per map. None of this travels in Map Pack exports; the connection details stay on this machine.',
    );

    sec.appendChild(this._buildWledSubsection());
    sec.appendChild(document.createElement('hr'));
    sec.appendChild(this._buildHaSubsection());
    sec.appendChild(document.createElement('hr'));
    sec.appendChild(this._buildSoundtracksSubsection());

    return sec;
  }

  private _buildSoundtracksSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-soundtracks';

    const heading = document.createElement('strong');
    heading.textContent = 'Soundtracks (YouTube)';
    wrap.appendChild(heading);

    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.innerHTML =
      'Pack-level background music that survives map switches. Paste ' +
      'YouTube (or YouTube Music) URLs into the Soundtracks panel ' +
      'slots — Theme, Intro, Outro, Playlist. No login needed for ' +
      'YouTube. Spotify slots arrive in a later patch. The actual ' +
      'track URLs travel with your <code>.mappadux</code> bundle.';
    wrap.appendChild(sub);

    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    const label = document.createElement('div');
    label.innerHTML = '<strong>Enable Soundtracks panel</strong><br>' +
      '<span class="settings-stat-sub">Adds a "Soundtracks" panel to the sidebar.</span>';
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isSoundtracksEnabled();
    input.addEventListener('change', () => setSoundtracksEnabled(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);
    row.append(label, toggle);
    wrap.appendChild(row);

    return wrap;
  }

  private _buildWledSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-wled';

    const heading = document.createElement('strong');
    heading.textContent = 'WLED endpoints';
    wrap.appendChild(heading);
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.textContent =
      'Each row is one WLED-firmware device on your network. Mappadux ' +
      'reads its preset list and fires a preset by id when you assign ' +
      'one to a map. Make sure the device is reachable from this browser ' +
      '(LAN, .local mDNS or IP).';
    wrap.appendChild(sub);

    const list = document.createElement('div');
    list.className = 'settings-stagecraft-wled-list';
    wrap.appendChild(list);

    const renderList = (): void => {
      list.innerHTML = '';
      const endpoints = getWledEndpoints();
      if (endpoints.length === 0) {
        const none = document.createElement('div');
        none.className = 'settings-stat';
        none.style.fontStyle = 'italic';
        none.textContent = 'No WLED devices configured.';
        list.appendChild(none);
        return;
      }
      for (const ep of endpoints) {
        const row = document.createElement('div');
        row.className = 'settings-stagecraft-wled-row';

        const labelEl = document.createElement('div');
        labelEl.innerHTML = `<strong>${escapeHtml(ep.label)}</strong>` +
          `<br><span class="settings-stat-sub">${escapeHtml(ep.url)}</span>` +
          `<br><span class="settings-stat-sub" data-status>(not tested yet)</span>`;

        const btnRow = document.createElement('div');
        btnRow.className = 'settings-btn-row';
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'btn btn--ghost btn--sm';
        testBtn.textContent = 'Test';
        const statusEl = labelEl.querySelector('[data-status]') as HTMLElement;
        testBtn.addEventListener('click', async () => {
          statusEl.textContent = '(testing…)';
          const info = await fetchWledInfo(ep.url);
          if (info.ok) {
            statusEl.textContent =
              `OK — "${info.data.name}", WLED ${info.data.version}, ${info.data.ledCount} LEDs.`;
          } else {
            statusEl.textContent = `Failed: ${info.message}`;
          }
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn--danger btn--sm';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', () => {
          removeWledEndpoint(ep.id);
          renderList();
        });
        btnRow.append(testBtn, delBtn);

        row.append(labelEl, btnRow);
        list.appendChild(row);
      }
    };

    renderList();

    // ── Add-device row ───────────────────────────────────────────────
    const addRow = document.createElement('div');
    addRow.className = 'settings-stagecraft-wled-add';
    addRow.style.marginTop = '8px';
    addRow.innerHTML =
      '<input type="text" data-field="label" placeholder="Label (e.g. Table strip)" />' +
      '<input type="text" data-field="url" placeholder="URL (e.g. 192.168.1.42 or wled-table.local)" />' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="add">Add</button>';
    const labelInput = addRow.querySelector<HTMLInputElement>('[data-field="label"]')!;
    const urlInput   = addRow.querySelector<HTMLInputElement>('[data-field="url"]')!;
    const addBtn     = addRow.querySelector<HTMLButtonElement>('[data-action="add"]')!;
    addBtn.addEventListener('click', () => {
      const label = labelInput.value.trim();
      const url   = normaliseEndpoint(urlInput.value);
      if (!label || !url) return;
      addWledEndpoint({ id: generateId(), label, url });
      labelInput.value = '';
      urlInput.value = '';
      renderList();
    });
    wrap.appendChild(addRow);

    return wrap;
  }

  private _buildHaSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-ha';

    const heading = document.createElement('strong');
    heading.textContent = 'Home Assistant';
    wrap.appendChild(heading);
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.innerHTML =
      'Connect to a Home Assistant instance to fire scenes or scripts on ' +
      'map switch. Create a <strong>long-lived access token</strong> in HA ' +
      'under Profile → Long-Lived Access Tokens. Mappadux only calls ' +
      'existing scenes/scripts you have authored in HA — set them up ' +
      'there first.';
    wrap.appendChild(sub);

    const existing = getHaConfig();
    const form = document.createElement('div');
    form.className = 'settings-stagecraft-ha-form';
    form.innerHTML =
      `<input type="text" data-field="url" placeholder="URL (e.g. http://homeassistant.local:8123)" value="${existing ? escapeHtml(existing.url) : ''}" />` +
      `<input type="password" data-field="token" placeholder="Long-lived access token" value="${existing ? escapeHtml(existing.token) : ''}" />`;
    wrap.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    btnRow.style.marginTop = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--ghost btn--sm';
    saveBtn.textContent = existing ? 'Save changes' : 'Save';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--danger btn--sm';
    clearBtn.textContent = 'Disconnect';
    clearBtn.hidden = !existing;
    const status = document.createElement('div');
    status.className = 'settings-stat-sub';
    status.style.marginTop = '4px';

    const urlInput   = form.querySelector<HTMLInputElement>('[data-field="url"]')!;
    const tokenInput = form.querySelector<HTMLInputElement>('[data-field="token"]')!;
    saveBtn.addEventListener('click', () => {
      const url = urlInput.value.trim().replace(/\/+$/, '');
      const token = tokenInput.value.trim();
      if (!url || !token) {
        status.textContent = 'Enter both URL and token to save.';
        return;
      }
      setHaConfig({ url, token });
      saveBtn.textContent = 'Save changes';
      clearBtn.hidden = false;
      status.textContent = 'Saved. The Lighting/Automation panel should now show Home Assistant.';
    });
    clearBtn.addEventListener('click', () => {
      setHaConfig(null);
      urlInput.value = '';
      tokenInput.value = '';
      saveBtn.textContent = 'Save';
      clearBtn.hidden = true;
      status.textContent = 'Disconnected. Mappadux will stop firing Home Assistant scenes.';
    });

    btnRow.append(saveBtn, clearBtn);
    wrap.append(btnRow, status);
    return wrap;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mkSection(title: string, intro: string, opts?: { open?: boolean }): HTMLElement {
  // Native <details> + <summary> for the collapsible behaviour —
  // browser owns the open/closed state, no JS event wiring needed.
  // Section-level CSS styles the summary like the rest of the
  // panel-title pattern (uppercase track + chevron) so settings
  // reads consistently with the main UI panels. Callers continue
  // to use `sec.appendChild(row)` and rows land inside the details
  // body where the browser hides them when closed.
  const sec = document.createElement('details');
  sec.className = 'settings-section';
  if (opts?.open) sec.open = true;

  const summary = document.createElement('summary');
  summary.className = 'settings-section-title';
  summary.textContent = title;
  sec.appendChild(summary);

  const p = document.createElement('p');
  p.className = 'settings-section-intro';
  p.textContent = intro;
  sec.appendChild(p);

  return sec;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Re-export for callers that want to enumerate keys without importing the
// settings module directly.
export type { StoredApiKey };
