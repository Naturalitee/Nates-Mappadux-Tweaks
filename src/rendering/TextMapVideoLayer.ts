import type { TextMapVideoElement } from '../types.ts';

type Project = (x: number, y: number) => { x: number; y: number } | null;

/**
 * TextMapVideoLayer (v2.16.91) — renders the LIVE YouTube iframes for a
 * text-map's video elements over the rendered map (GM canvas + player +
 * projector). Video elements aren't baked into the rasterised page image,
 * so this overlay tracks each element's map-relative geometry every frame
 * (project the element's % rect → screen px), keeping the video glued to
 * the map through pan / zoom. The iframes are interactive so each viewer
 * uses YouTube's own controls (the GM can preview; players can watch their
 * own). Re-using an existing iframe across updates avoids reloading the
 * video on every reposition.
 */
export class TextMapVideoLayer {
  private videos: TextMapVideoElement[] = [];
  private hosts = new Map<string, HTMLElement>();
  private raf = 0;

  constructor(private root: HTMLElement, private project: Project) {
    const loop = () => { this._position(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  setVideos(videos: TextMapVideoElement[]): void {
    const ids = new Set(videos.map((v) => v.id));
    for (const [id, host] of this.hosts) {
      if (!ids.has(id)) { host.remove(); this.hosts.delete(id); }
    }
    for (const v of videos) {
      let host = this.hosts.get(v.id);
      // Rebuild only if the video id changed (else keep playing).
      if (host && host.dataset['videoId'] !== v.videoId) { host.remove(); this.hosts.delete(v.id); host = undefined; }
      if (!host) {
        host = document.createElement('div');
        host.className = 'textmap-video';
        host.dataset['videoId'] = v.videoId;
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube.com/embed/${v.videoId}?rel=0`;
        frame.allow = 'autoplay; encrypted-media; picture-in-picture';
        frame.setAttribute('frameborder', '0');
        frame.allowFullscreen = true;
        host.appendChild(frame);
        this.root.appendChild(host);
        this.hosts.set(v.id, host);
      }
    }
    this.videos = videos;
    this._position();
  }

  clear(): void { this.setVideos([]); }

  destroy(): void { cancelAnimationFrame(this.raf); }

  private _position(): void {
    for (const v of this.videos) {
      const host = this.hosts.get(v.id);
      if (!host) continue;
      const tl = this.project(v.x / 100, v.y / 100);
      const br = this.project((v.x + v.w) / 100, (v.y + v.h) / 100);
      if (!tl || !br) { host.style.visibility = 'hidden'; continue; }
      host.style.visibility = '';
      host.style.left   = `${tl.x}px`;
      host.style.top    = `${tl.y}px`;
      host.style.width  = `${Math.max(8, br.x - tl.x)}px`;
      host.style.height = `${Math.max(8, br.y - tl.y)}px`;
      host.style.transform = v.rotation ? `rotate(${v.rotation}deg)` : '';
    }
  }
}
