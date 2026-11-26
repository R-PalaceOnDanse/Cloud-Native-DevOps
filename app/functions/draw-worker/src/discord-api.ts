/**
 * Discord Interactions API Client.
 * Edits deferred interaction responses and posts follow-ups (Issue #142 / C07 §1).
 */

export interface DiscordEditPayload {
  content?: string;
  embeds?: readonly unknown[];
  flags?: number;
}

export class DiscordApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://discord.com/api/v10') {
    this.baseUrl = baseUrl;
  }

  /**
   * Edits the original deferred interaction response.
   */
  public async editOriginalResponse(
    applicationId: string,
    interactionToken: string,
    payload: DiscordEditPayload
  ): Promise<boolean> {
    if (!applicationId || !interactionToken) {
      return false;
    }

    const url = `${this.baseUrl}/webhooks/${applicationId}/${interactionToken}/messages/@original`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Discord API transient error: ${res.status}`);
    }
    if (!res.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: `Discord API rejected editOriginalResponse (${res.status})` }));
    }
    return res.ok;
  }

  /**
   * Posts an image file follow-up message to Discord (e.g. for /get or /snapshot).
   */
  public async postFollowupWithImage(
    applicationId: string,
    interactionToken: string,
    imageBuffer: Buffer,
    filename: string,
    caption: string
  ): Promise<boolean> {
    if (!applicationId || !interactionToken) {
      return false;
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
    formData.append('files[0]', blob, filename);
    formData.append(
      'payload_json',
      JSON.stringify({
        content: caption,
        attachments: [{ id: 0, filename }],
      })
    );

    const url = `${this.baseUrl}/webhooks/${applicationId}/${interactionToken}`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Discord API transient error: ${res.status}`);
    }
    if (!res.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: `Discord API rejected postFollowupWithImage (${res.status})` }));
    }
    return res.ok;
  }
}

export const discordApiClient = new DiscordApiClient();
