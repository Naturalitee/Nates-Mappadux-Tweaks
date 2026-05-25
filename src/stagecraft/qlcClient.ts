/**
 * QLC+ (Q Light Controller Plus) WebSocket client. Mappadux scope:
 * list the Functions (scenes / chasers / collections / sequences /
 * RGB matrices) the user has already authored in QLC+, and fire one
 * by id when a map is loaded. Mappadux never authors DMX programming
 * — the user builds Functions in QLC+'s own UI.
 *
 * Wire format: QLC+ exposes a WebSocket at `ws://<host>:9999/qlcplusWS`
 * (port configurable in the QLC+ Web UI). Messages are pipe-separated
 * strings:
 *
 *   Outgoing:
 *     "QLC+API|getFunctionsList"
 *     "QLC+API|setFunctionStatus|<id>|<1=start|0=stop>"
 *
 *   Incoming (relevant ones):
 *     "QLC+API|getFunctionsList|<id1>|<name1>|<type1>|<id2>|<name2>|<type2>|..."
 *     "QLC+API|setFunctionStatus|<id>|<state>"
 *
 * No auth — QLC+'s web interface is local-network-only by default.
 * Users with port-exposed installs need to firewall it themselves.
 *
 * Connect-per-request pattern (no persistent socket): every call
 * opens a fresh WS, sends, waits for the reply (or times out), and
 * closes. Simpler than reconnection logic; the latency cost is one
 * round-trip per call which is fine for "list functions on panel
 * open" + "fire function on map switch" — both rare events.
 */

const DEFAULT_TIMEOUT_MS = 4000;
const PORT_DEFAULT = 9999;

export type QlcFunctionType =
  | 'Scene' | 'Chaser' | 'Collection' | 'Sequence' | 'RGBMatrix'
  | 'EFX'   | 'Script' | 'Audio'      | 'Video'    | 'Show'
  | 'Unknown';

export interface QlcFunction {
  id:   number;
  name: string;
  type: QlcFunctionType;
}

export interface QlcFailure {
  ok: false;
  reason: 'timeout' | 'network' | 'parse';
  message: string;
}

export interface QlcSuccess<T> {
  ok: true;
  data: T;
}

export type QlcResult<T> = QlcSuccess<T> | QlcFailure;

/** Normalise a user-supplied endpoint into a `ws://host:port` URL.
 *  Accepts bare host (`192.168.1.50`), host:port, http:// scheme
 *  (rewritten to ws://), or full ws:// URL. */
export function normaliseQlcEndpoint(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return '';
  // Strip http(s):// — QLC+ is WebSocket.
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^wss?:\/\//i, '');
  // If no port, add the default.
  if (!/:\d+$/.test(s)) s = `${s}:${PORT_DEFAULT}`;
  return `ws://${s}/qlcplusWS`;
}

/** Open a WS, send `payload`, wait for the FIRST message that starts
 *  with the given prefix (so unrelated chatter the server may emit
 *  doesn't satisfy the wait), or undefined if no prefix filter. */
function _wsRequest(endpoint: string, payload: string, expectPrefix?: string): Promise<QlcResult<string>> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch (e) {
      resolve({ ok: false, reason: 'network', message: `Could not open QLC+ WebSocket: ${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* nothing */ }
      resolve({ ok: false, reason: 'timeout', message: `QLC+ ${endpoint} timed out after ${DEFAULT_TIMEOUT_MS} ms` });
    }, DEFAULT_TIMEOUT_MS);

    ws.onopen = () => {
      try { ws.send(payload); }
      catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: 'network', message: `Send failed: ${(e as Error).message}` });
        try { ws.close(); } catch { /* nothing */ }
      }
    };
    ws.onmessage = (ev) => {
      if (settled) return;
      const msg = typeof ev.data === 'string' ? ev.data : '';
      if (expectPrefix && !msg.startsWith(expectPrefix)) return; // wait for the matching reply
      settled = true;
      clearTimeout(timer);
      resolve({ ok: true, data: msg });
      try { ws.close(); } catch { /* nothing */ }
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: 'network', message: `QLC+ WebSocket error at ${endpoint}` });
      try { ws.close(); } catch { /* nothing */ }
    };
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: 'network', message: `QLC+ WebSocket closed before reply` });
    };
  });
}

/** Quick connectivity probe — opens a WS, requests function list,
 *  reports how many came back. Used by the Settings Test button. */
export async function fetchInfo(endpoint: string): Promise<QlcResult<{ functionCount: number }>> {
  const ep = normaliseQlcEndpoint(endpoint);
  if (!ep) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const result = await fetchFunctions(ep);
  if (!result.ok) return result;
  return { ok: true, data: { functionCount: result.data.length } };
}

/** Pull the function list. Returns parsed QlcFunction[]. */
export async function fetchFunctions(endpoint: string): Promise<QlcResult<QlcFunction[]>> {
  const ep = endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
    ? endpoint
    : normaliseQlcEndpoint(endpoint);
  if (!ep) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const reply = await _wsRequest(ep, 'QLC+API|getFunctionsList', 'QLC+API|getFunctionsList');
  if (!reply.ok) return reply;
  // Reply format: QLC+API|getFunctionsList|<id>|<name>|<type>|<id>|<name>|<type>|...
  const parts = reply.data.split('|');
  if (parts.length < 2) {
    return { ok: false, reason: 'parse', message: `Unexpected QLC+ reply shape: ${reply.data.slice(0, 80)}` };
  }
  const fns: QlcFunction[] = [];
  // Skip the first two header tokens (API name + command echo).
  for (let i = 2; i + 2 < parts.length + 1; i += 3) {
    const idRaw = parts[i];
    const name  = parts[i + 1];
    const type  = parts[i + 2];
    if (idRaw === undefined || name === undefined) break;
    const id = Number(idRaw);
    if (!Number.isFinite(id)) continue;
    fns.push({
      id,
      name,
      type: (type as QlcFunctionType) ?? 'Unknown',
    });
  }
  fns.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: fns };
}

/** Fire (start) a Function by id. Sends setFunctionStatus|<id>|1.
 *  QLC+'s "stop" is the same command with 0. */
export async function fireFunction(endpoint: string, functionId: number): Promise<QlcResult<void>> {
  const ep = endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
    ? endpoint
    : normaliseQlcEndpoint(endpoint);
  if (!ep) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const payload = `QLC+API|setFunctionStatus|${functionId}|1`;
  const result = await _wsRequest(ep, payload);
  if (!result.ok) return result;
  return { ok: true, data: undefined };
}
