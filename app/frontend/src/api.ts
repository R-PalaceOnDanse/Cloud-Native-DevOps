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
  traceId?: string;
  spanId?: string;
  pixelCount: number;
}

export interface DrawErrorResponse {
  error: string;
  retryAfterSeconds?: number;
}

function generateRandomHex(byteCount: number): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(byteCount);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(16).substring(2).padEnd(byteCount * 2, '0').substring(0, byteCount * 2);
}

/**
 * Generates standard W3C traceparent header: 00-${traceId}-${spanId}-${flags}.
 * Initiates distributed trace context right from the browser (Issue #88).
 */
export function generateW3CTraceParent(): { traceParent: string; traceId: string; spanId: string } {
  const traceId = generateRandomHex(16);
  const spanId = generateRandomHex(8);
  return {
    traceParent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
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

  /** True when a real API Gateway URL is configured (VITE_API_GATEWAY_URL), false in local dev. */
  public isRemote(): boolean {
    return /^https:\/\//.test(this.baseUrl);
  }

  /**
   * Submits a batch of drawn pixels to the Web Draw Proxy.
   * Propagates W3C traceparent and correlation ID for distributed tracing (Issue #88, #89).
   */
  public async submitDraw(
    pixels: PixelPayload[],
    token?: string
  ): Promise<DrawSuccessResponse | DrawErrorResponse> {
    if (pixels.length === 0) {
      return { error: 'No pixels to draw.' };
    }

    const { traceParent, traceId, spanId } = generateW3CTraceParent();
    const correlationId = `web-${Date.now()}-${traceId.substring(0, 8)}`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'traceparent': traceParent,
        'X-Correlation-ID': correlationId,
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.baseUrl}/draw`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pixels }),
      });

      if (response.status === 202) {
        const data = (await response.json()) as DrawSuccessResponse;
        return {
          ...data,
          traceId: data.traceId || traceId,
          spanId: data.spanId || spanId,
          correlationId: data.correlationId || correlationId,
        };
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        return {
          error: json.error || 'Rate limit reached. Please wait a moment.',
          retryAfterSeconds: retryAfter ? parseInt(retryAfter, 10) : 5,
        };
      }

      const errJson = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        error: errJson.error || `Server error (${response.status}).`,
      };
    } catch {
      if (this.isRemote()) {
        return { error: 'Network error: the draw was not sent.' };
      }
      // In local dev without gateway running, acknowledge optimistically
      return {
        status: 'accepted',
        eventId: 'local-dev-mock-id',
        correlationId,
        traceId,
        spanId,
        pixelCount: pixels.length,
      };
    }
  }
}

export const drawApiClient = new DrawApiClient();
