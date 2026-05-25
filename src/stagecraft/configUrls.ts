/**
 * Helpers that turn a Stagecraft connection's endpoint into a URL
 * the GM can open in a new tab to author / edit presets / scenes /
 * Functions in the device's own UI. Same pattern across the three
 * lighting integrations: Mappadux only references presets, so the
 * GM needs a one-click way back to the authoring tool.
 */

/** WLED's web UI lives at the device's root URL — `http://<host>/`. */
export function wledConfigUrl(endpoint: string): string {
  // The endpoint is already a normalised base (e.g. http://wled.local).
  // Strip any trailing path so / opens the WLED main UI.
  return endpoint.replace(/\/+$/, '') + '/';
}

/** Home Assistant's URL goes straight to its dashboard. Deep-linking to
 *  scene config: /config/scene/dashboard. We use the base because not
 *  every HA user organises by scene (scripts / automations land in
 *  different sections); /config covers both. */
export function haConfigUrl(haUrl: string): string {
  return haUrl.replace(/\/+$/, '') + '/config';
}

/** QLC+'s web UI shares the endpoint host:port — strip the WebSocket
 *  path and scheme to get a browsable URL. The Web Interface page
 *  lets the GM author Functions. */
export function qlcConfigUrl(qlcWsUrl: string): string {
  // qlcWsUrl looks like ws://192.168.1.50:9999/qlcplusWS — convert to
  // http://192.168.1.50:9999/ for the web UI.
  return qlcWsUrl
    .replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://')
    .replace(/\/qlcplusWS\/?$/i, '/')
    .replace(/\/+$/, '/') ;
}
