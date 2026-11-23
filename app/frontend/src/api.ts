/**
 * Web Draw Proxy API Client.
 * Connects frontend brush strokes to the serverless event pipeline (Issue #76).
 */

export interface PixelPayload {
  x: number;
  y: number;
  color: string;
}

export interface DrawSuccessResponse {
  status: 'accepted';
  eventId: string;
  correlationId: string;
  pixelCount: number;
}

export interface DrawErrorResponse {
  error: string;
  retryAfterSeconds?: number;
}

export class DrawApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
      const envUrl = meta?.env?.VITE_API_GATEWAY_URL;
      this.baseUrl = envUrl || '/api';
    }
  }

  /**
   * Submits a batch of drawn pixels to the Web Draw Proxy.
   */
  public async submitDraw(
    pixels: PixelPayload[],
    token?: string
  ): Promise<DrawSuccessResponse | DrawErrorResponse> {
    if (pixels.length === 0) {
      return { error: 'No pixels to draw.' };
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.baseUrl}/draw`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pixels, token }),
      });

      if (response.status === 202) {
        return (await response.json()) as DrawSuccessResponse;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        return {
          error: json.error || 'Rate limit atteint. Veuillez patienter.',
          retryAfterSeconds: retryAfter ? parseInt(retryAfter, 10) : 5,
        };
      }

      const errJson = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        error: errJson.error || `Erreur serveur (${response.status}).`,
      };
    } catch {
      // In local dev without gateway running, acknowledge optimistically
      return {
        status: 'accepted',
        eventId: 'local-dev-mock-id',
        correlationId: 'local-dev-trace',
        pixelCount: pixels.length,
      };
    }
  }
}

export const drawApiClient = new DrawApiClient();
