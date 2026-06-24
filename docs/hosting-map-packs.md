# Hosting & sharing Map Packs by URL

Mappadux can load a Map Pack straight from a web address:

```
https://www.mappadux.com/?bundle=<URL-to-your-.mappadux-file>
```

e.g. `https://www.mappadux.com/?bundle=https://raw.githubusercontent.com/you/your-repo/main/dungeon.mappadux`

Open that link and Mappadux fetches the pack and offers to load it (it asks before
replacing your current workspace). This page explains where to put the `.mappadux`
file so the link loads in **one click**, and what happens when it can't.

---

## The catch: browser security

A pack hosted on a **different domain** to Mappadux is subject to two browser
rules that Mappadux can't override from the page:

1. **HTTPS only.** The URL must be `https://`. A browser blocks an `http://`
   file loaded into an `https://` page ("mixed content"). Use `https://`.
2. **CORS.** To *read* a cross-domain file, the host must send the header
   `Access-Control-Allow-Origin`. Many file hosts don't, so the browser blocks
   the read.

If the host doesn't allow cross-domain reads, Mappadux **falls back gracefully**:
it offers a one-click **Download**, then you load the downloaded file from disk
(a couple of extra clicks). Nothing is lost — it just isn't seamless.

To get the seamless one-click load, host the file somewhere that serves it over
**https with CORS**. The options below all do.

---

## Easiest: GitHub (free, works out of the box)

GitHub's `raw` URLs are https and send `Access-Control-Allow-Origin: *`, so they
load in one click with no setup.

1. Create a **public** GitHub repository (or use an existing one).
2. Upload your `.mappadux` file to it.
3. Open the file on GitHub and click **Raw** — copy that address. It looks like:
   `https://raw.githubusercontent.com/<user>/<repo>/<branch>/<file>.mappadux`
   (Use the **raw** address, *not* the normal `github.com/.../blob/...` page.)
4. Share: `https://www.mappadux.com/?bundle=<that raw URL>`

Notes: the repo must be **public**, and GitHub caps files at **100 MB**.

---

## Other one-click hosts

Any host works as long as it serves the file over **https** with a CORS header.

- **Cloudflare R2** (public bucket) — free storage tier, no egress fees. Add a
  CORS rule allowing `GET` from `*` (or just `https://www.mappadux.com`).
- **Amazon S3** — make the object public and add a CORS configuration allowing
  `GET`.
- **Your own web server** — add the CORS header for `.mappadux` files:
  - **nginx**: `add_header 'Access-Control-Allow-Origin' '*' always;`
  - **Apache**: `Header set Access-Control-Allow-Origin "*"`
- **Same site** — if the file lives on `mappadux.com` itself, no CORS is needed
  (same-origin requests aren't restricted).

**Avoid** Google Drive and Dropbox *share* links for this — they redirect and/or
don't send CORS, so they fall back to the download step.

---

## How it behaves, in short

| Where the pack is hosted | `?bundle=` result |
|---|---|
| GitHub `raw`, or any https host that sends CORS | One-click load |
| Same site (mappadux.com) | One-click load |
| https host **without** CORS | Download, then load from disk (extra clicks) |
| `http://` link | Blocked — re-host over `https://` |

If you'd rather not depend on a third party, **host the file yourself** (any of
the options above) and share your own `?bundle=` links.
