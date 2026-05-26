# Mappadux — Security Notes

Living record of security-relevant decisions, threat model, and the
reasoning behind notable trade-offs. Update when a config or
architectural choice has security implications.

---

## Threat model

Mappadux is a **client-side data-pack VTT** with:

- No server-side application state (Vercel hosts static assets only).
- No user accounts on Mappadux itself (no auth, no central credentials).
- Per-machine local storage (IndexedDB + localStorage) for the user's
  maps, audio, settings, calibrations, etc.
- Optional P2P connections to player browsers via PeerJS broker (the
  public broker; no centralised auth).
- Optional outbound connections to third-party services the user
  has opted into (YouTube IFrame, Spotify Web Playback SDK,
  Freesound audio CDN, Home Assistant LAN device, WLED LAN device,
  QLC+ LAN device).

### What we genuinely worry about

| Concern | Mitigation |
|---|---|
| **XSS via user-supplied content** (text-map HTML, marker labels, pack metadata) | All user input is escaped before rendering. TextMap rich-text editor uses a strict whitelist; bundle import sanitises payloads. |
| **Malicious `.mappadux` bundles** | Import validates structure; rejects unknown shapes; bundles never get executable permissions (no `<script>` revival). |
| **Phishing / fake Mappadux clones** | Out of scope for HTTP headers — domain ownership + DNS handles this. |
| **Leaked API keys / tokens** | Per-browser localStorage; never travel in `.mappadux` bundle exports ([[project_dmr_storage_map]] enforces this). |
| **CSRF against the app** | Mappadux is read-only client-side; no state-changing requests to a server. CSRF doesn't apply. |
| **PeerJS broker compromise** | Broker is public infrastructure. Mappadux data is sent over the P2P channel, not the broker. Worst case: broker outage breaks new connections. |

### What we don't worry about (and why)

| Concern | Why it's negligible for Mappadux |
|---|---|
| **Tabnabbing via `window.opener`** | All cross-origin links Mappadux opens use modern browser defaults that null `window.opener`. The app's own surface doesn't pop windows to attacker-controlled URLs. |
| **Spectre / Meltdown side-channel reads** | Nothing sensitive flows between origins. Cross-origin resources Mappadux loads (YouTube, Freesound, Google Fonts, Spotify) are PUBLIC content. There's no user secret an attacker script could exfiltrate via timing. |
| **CSP for our own code** | No external scripts execute against our origin (no third-party analytics, no inline-script injections, no eval). Strict CSP would add maintenance burden without closing realistic attack vectors. |

---

## Notable decisions

### 2026-05-27 — Removed `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` from `vercel.json`

The PWA rewrite (v2.10) shipped with cross-origin isolation enabled:

```json
"Cross-Origin-Opener-Policy": "same-origin"
"Cross-Origin-Embedder-Policy": "require-corp"  // later relaxed to "credentialless"
```

These were prudent defense-in-depth at the time. Removed now because
they broke real features without providing any practical security
benefit for Mappadux.

#### Why they were originally added

Cross-origin isolation enables:

- `SharedArrayBuffer` (multi-threaded WebAssembly, audio worklets)
- High-precision `performance.now()` timestamps
- `crossOriginIsolated` boolean (lets feature-gated code check)

In some apps, isolation also mitigates Spectre-class side-channel
attacks against cross-origin data.

#### Why they're not needed for Mappadux

- **`SharedArrayBuffer`**: not used anywhere in the codebase (grep
  confirms zero references). No WASM threads, no AudioWorklet.
- **High-precision timing**: Mappadux uses millisecond timing
  throughout (animations, transitions, scan rings). Nanosecond
  precision adds nothing.
- **Spectre side-channel protection**: nothing sensitive crosses
  origins. Cross-origin assets we load (YouTube, Freesound, Google
  Fonts, Spotify) are PUBLIC content. There's no user secret an
  attacker script could exfiltrate via timing.

#### Why they actively HURT

- **YouTube IFrame Player blocked** (v2.15.x Soundtracks): COEP
  `credentialless` makes the YT embed iframe load without cookies,
  preventing the IFrame Player's auth-dependent init from
  completing. Symptom: `onReady` never fires, player wedged at
  "Loading…".
- **Spotify Web Playback SDK would hit the same wall** when first
  tested (same auth-handshake pattern).
- **YT Premium ad-free playback degraded**: without cookies in the
  embed, even Premium users would get ads on embedded videos.

#### What we lose

- `SharedArrayBuffer` capability (unused).
- High-precision `performance.now()` (unused).
- `crossOriginIsolated === true` (checked by zero lines of code).

#### What we gain

- YouTube IFrame Player works.
- Spotify Web Playback SDK works.
- YT Premium ad-free playback carries through to embeds.
- One less moving part in the deployment config.

#### Residual risk

- **Tabnabbing**: a malicious site opening mappadux.com in a new
  tab could theoretically use `window.opener` to manipulate the
  original tab. Modern browsers default `rel="noopener"` for all
  cross-origin links (Chrome since 2020, Firefox + Safari follow),
  so the attack vector is largely closed at the browser level.
  Realistic impact: near zero for typical Mappadux users (who
  arrive via direct URL entry, bookmarks, Discord links, etc.).
- **Cross-origin attack surface widens slightly**: any future
  cross-origin script Mappadux loads could theoretically be a
  vector. Current loads are all explicit (YouTube IFrame Player
  script, Spotify SDK, Freesound audio CDN, Google Fonts via
  `@fontsource`, Vercel Analytics) and well-understood.

#### When to reconsider

If Mappadux ever adds:

- Real-time audio synthesis via `AudioWorklet` + `SharedArrayBuffer`
- Video transcoding via `ffmpeg.wasm` with threads
- A feature that explicitly checks `crossOriginIsolated`
- A cross-origin script load from a less-trusted source

…then re-evaluate. The headers can be added back in `vercel.json`
without affecting any other config:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "credentialless" }
      ]
    }
  ]
}
```

---

## Reporting security issues

If you find a real security issue in Mappadux, contact
`frunk@frunk.net` directly rather than filing a public GitHub issue.
