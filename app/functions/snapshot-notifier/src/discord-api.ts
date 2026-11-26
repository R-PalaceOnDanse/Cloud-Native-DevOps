/**
 * Edits the original answer of a Discord interaction through its webhook. The interaction token is
 * the credential (valid 15 minutes): no bot token is needed. Issue #169.
 *
 * Unlike the worker's client it never hides a network error: the caller decides whether to retry.
 */

export interface DiscordEditResult {
  ok: boolean;
  status: number;
}

export interface DiscordWebhook {
  editOriginal(applicationId: string, interactionToken: string, payload: { content: string }): Promise<DiscordEditResult>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export class DiscordWebhookClient implements DiscordWebhook {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://discord.com/api/v10'
  ) {}

  async editOriginal(applicationId: string, interactionToken: string, payload: { content: string }): Promise<DiscordEditResult> {
    const url = `${this.baseUrl}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`;
    const res = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Stay well under the function timeout, so a hung call ends in a retry instead of a kill.
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  }
}
