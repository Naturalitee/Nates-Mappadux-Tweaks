import { getLLMSettings, getLLMApiKey } from '../storage/localSettings.ts';

/**
 * LLMClient (v2.17 Player Voice) — talks to any OpenAI-compatible chat
 * completions endpoint so the GM reply assistant works with a local LM Studio
 * server (no key) or a hosted provider like OpenRouter (key + model).
 *
 * `suggest()` sends the GM's editable system prompt plus the player's note and
 * splits the reply into discrete options the GM can drop into a reply box. The
 * default prompt asks for four numbered options; parsing is heuristic so a
 * GM's own prompt format still yields usable chips (falling back to the whole
 * response as a single option).
 */
export class LLMClient {
  /** Build a client from current settings, or null if the assistant isn't
   *  enabled / configured. */
  static fromSettings(): LLMClient | null {
    const s = getLLMSettings();
    if (!s.enabled) return null;
    if (!s.baseUrl.trim() || !s.model.trim()) return null;
    return new LLMClient(s.baseUrl.trim(), s.model.trim(), s.systemPrompt, getLLMApiKey());
  }

  /**
   * Hit `${baseUrl}/models` and return the model ids the endpoint advertises.
   * Used by Settings to populate the model dropdown + test the connection
   * (LM Studio, OpenRouter, and most OpenAI-compatible servers all serve it).
   */
  static async listModels(baseUrl: string, apiKey: string): Promise<string[]> {
    if (!baseUrl.trim()) throw new Error('Set a base URL first (e.g. http://localhost:1234/v1).');
    const url = `${baseUrl.trim().replace(/\/$/, '')}/models`;
    const headers: Record<string, string> = {};
    if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      throw new Error(`Couldn't reach ${baseUrl} (${(err as Error).message}). Is the server running and is CORS enabled on it?`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Endpoint returned ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const data = await res.json() as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  }

  constructor(
    private baseUrl: string,
    private model: string,
    private systemPrompt: string,
    private apiKey: string,
  ) {}

  async suggest(playerMessage: string): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.8,
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user',   content: playerMessage },
          ],
        }),
      });
    } catch (err) {
      throw new Error(`Couldn't reach the LLM at ${this.baseUrl} (${(err as Error).message}). Is it running?`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM returned ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new Error('LLM returned an empty response.');
    return parseOptions(content);
  }
}

/**
 * Split an assistant response into discrete reply options. Handles the default
 * "**1. Title**\n> body" format and looser numbered/bulleted lists; falls back
 * to the whole text as one option.
 */
export function parseOptions(text: string): string[] {
  const trimmed = text.trim();
  // Split on numbered headings: "1." / "**1." / "1)" at the start of a line.
  const parts = trimmed.split(/\n(?=\s*\**\s*\d+[.)])/);
  const cleaned = parts
    .map((p) => cleanOption(p))
    .filter((p) => p.length > 0);
  return cleaned.length >= 2 ? cleaned : [trimmed];
}

/** Strip leading numbering + markdown emphasis / quote markers, keeping the
 *  human-usable reply text (narrative beat + skill ask joined). v2.16.51 —
 *  also strips legacy "The Title (Tag)" prefixes the old default prompt
 *  produced as bold category headings, and unwraps the straight / curly
 *  quotation marks that the legacy template put around the skill ask.
 *  Existing GMs with custom prompts inherit the cleanup without having
 *  to edit their settings. */
function cleanOption(block: string): string {
  const joined = block
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\**\s*\d+[.)]\s*/, '') // leading "1." / "**1.**"
        .replace(/^\s*>\s?/, '')             // blockquote marker
        .replace(/\*\*/g, '')                // bold markers
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
  return joined
    // Legacy heading prefix: "The Green Light (Positive)", "The
    // Complication (Yes, but...)", "The GM's Choice" — short
    // Title-Case phrase optionally followed by a parenthetical, then
    // the actual prose starting with a capital letter.
    .replace(/^The\s+[A-Z][A-Za-z'’\s-]{0,40}(?:\s*\([^)]+\))?\s+(?=[A-Z"“])/u, '')
    // Strip enclosing straight and curly quotation marks anywhere in
    // the option. The legacy template wrapped the skill ask in quotes
    // ("Give me a [Skill] roll."); we want the bare prose.
    .replace(/[""'']/g, '')
    .trim();
}
