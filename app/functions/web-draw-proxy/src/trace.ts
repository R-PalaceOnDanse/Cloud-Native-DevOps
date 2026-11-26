/**
 * Writes one span to Cloud Trace (API v2 batchWrite) with the identity of the function
 * (roles/cloudtrace.agent). Same file in every function: discord-proxy, web-draw-proxy, draw-worker.
 *
 * The trace ID travels in the W3C traceparent of the event envelope, so a request is one trace in
 * Cloud Trace: proxy span -> worker span (parent = proxy span). The logs carry the same trace ID
 * (logging.googleapis.com/trace), so Cloud Trace shows them next to the spans. Issue #88, C08 §6.
 *
 * Only runs on Cloud Run (K_SERVICE set); never throws, never waits more than 1.5 s.
 */

export interface SpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  start: Date;
  end: Date;
  attributes?: Record<string, string | number | boolean | undefined>;
}

let client: { request(opts: { url: string; method: string; data: unknown; timeout: number }): Promise<unknown> } | undefined;

export async function exportSpan(span: SpanInput): Promise<void> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!process.env.K_SERVICE || !projectId) return;
  try {
    if (!client) {
      const { GoogleAuth } = await import('google-auth-library');
      client = (await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/trace.append'] }).getClient()) as unknown as typeof client;
    }
    const attributeMap: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(span.attributes ?? {})) {
      if (value === undefined) continue;
      attributeMap[key] =
        typeof value === 'number' ? { intValue: String(Math.trunc(value)) }
        : typeof value === 'boolean' ? { boolValue: value }
        : { stringValue: { value: String(value).slice(0, 256) } };
    }
    await client!.request({
      url: `https://cloudtrace.googleapis.com/v2/projects/${projectId}/traces:batchWrite`,
      method: 'POST',
      timeout: 1500,
      data: {
        spans: [{
          name: `projects/${projectId}/traces/${span.traceId}/spans/${span.spanId}`,
          spanId: span.spanId,
          ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          displayName: { value: span.name },
          startTime: span.start.toISOString(),
          endTime: span.end.toISOString(),
          attributes: { attributeMap },
        }],
      },
    });
  } catch (err) {
    console.error(JSON.stringify({ severity: 'WARNING', message: 'Span not exported to Cloud Trace', error: err instanceof Error ? err.message : String(err) }));
  }
}

/** "00-<trace>-<span>-01" -> { traceId, spanId }, or undefined. */
export function parseTraceParent(value: unknown): { traceId: string; spanId: string } | undefined {
  const m = String(value ?? '').trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);
  return m ? { traceId: m[1]!.toLowerCase(), spanId: m[2]!.toLowerCase() } : undefined;
}
