/**
 * Web Draw Proxy Cloud Function.
 * Fulfills Issue #76, C07 §3.2 and ADR-0006.
 * 
 * Verifies token, validates pixel stroke batch, formats event envelope,
 * and publishes to Pub/Sub topic 'pixel-draw-events'.
 * Strictly zero direct storage writes.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import type { Request, Response } from '@google-cloud/functions-framework';
import { validateDrawBatch } from './validator.js';
import { identityFromGateway, USERINFO_HEADER } from './auth.js';
import { EventPublisher, PubSubEventPublisher, EventEnvelope } from './publisher.js';
import { exportSpan } from './trace.js';

export interface PixelDrawData {
  userId: string;
  author: string;
  pixels: Array<{ x: number; y: number; color: string }>;
}

/** The browser calls the gateway from the frontend origin: answer the CORS preflight. */
function setCors(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Correlation-ID, traceparent');
  res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-ID, traceparent');
  res.setHeader('Access-Control-Max-Age', '3600');
  res.setHeader('Vary', 'Origin');
}

export function createDrawProxyHandler(publisher: EventPublisher, topicName = process.env.PIXEL_DRAW_TOPIC || 'pixel-draw-events') {
  return async function webDrawProxy(req: Request, res: Response): Promise<void> {
    const start = new Date();
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // 1. Only allow POST method
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
      return;
    }

    // 2. Correlation ID & Distributed Tracing Context (Issue #88, #89)
    const incomingCorrelationId = req.header('X-Correlation-ID');
    const correlationId = incomingCorrelationId && incomingCorrelationId.trim().length > 0
      ? incomingCorrelationId.trim()
      : randomUUID();

    const incomingTraceParent = req.header('traceparent') || req.header('X-Cloud-Trace-Context');
    let traceId = randomBytes(16).toString('hex');
    let parentSpanId: string | undefined = undefined;

    if (incomingTraceParent) {
      const matchW3C = incomingTraceParent.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
      if (matchW3C) {
        traceId = matchW3C[1]!.toLowerCase();
        parentSpanId = matchW3C[2]!.toLowerCase();
      } else {
        const matchGcp = incomingTraceParent.trim().match(/^([0-9a-f]{32})/i);
        if (matchGcp) {
          traceId = matchGcp[1]!.toLowerCase();
        }
      }
    }

    const spanId = randomBytes(8).toString('hex');
    const traceParent = `00-${traceId}-${spanId}-01`;

    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('traceparent', traceParent);

    const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'teampasx-cloudnative-dev';

    // Cloud Logging structured trace linking (Issue #88, C08 §6)
    console.log(
      JSON.stringify({
        severity: 'INFO',
        message: 'Received draw request',
        correlationId,
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
        'logging.googleapis.com/spanId': spanId,
        'logging.googleapis.com/trace_sampled': true,
      })
    );

    // 3. User identity, verified by the gateway (Firebase ID token of a Discord-linked account)
    const auth = identityFromGateway(req.header(USERINFO_HEADER));

    if (!auth.authenticated || !auth.userId) {
      res.status(401).json({
        error: auth.error || 'Unauthorized.',
        correlationId,
      });
      return;
    }

    // 4. Validate Pixel Batch
    const rawPixels = req.body?.pixels;
    const validation = validateDrawBatch(rawPixels);

    if (!validation.valid || !validation.pixels) {
      res.status(400).json({
        error: validation.error || 'Invalid pixel payload.',
        correlationId,
      });
      return;
    }

    // 5. Build Event Envelope (includes traceParent for distributed tracing)
    const event: EventEnvelope<PixelDrawData> = {
      id: randomUUID(),
      correlationId,
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      traceParent,
      data: {
        userId: auth.userId,
        author: auth.username ?? `discord:${auth.userId}`,
        pixels: validation.pixels,
      },
    };

    // 6. Publish to Pub/Sub (Asynchronous pipeline, zero direct storage writes)
    const span = (outcome: string) =>
      exportSpan({
        traceId,
        spanId, // the worker's span is its child (traceParent of the event)
        parentSpanId, // the browser's span, when it sent a traceparent
        name: 'web-draw-proxy /draw',
        start,
        end: new Date(),
        attributes: { correlationId, eventType: 'pixel.draw', pixels: validation.pixels?.length ?? 0, outcome },
      });
    try {
      const messageId = await publisher.publish(topicName, event);
      await span('published');

      res.status(202).json({
        status: 'accepted',
        eventId: event.id,
        correlationId,
        traceId,
        spanId,
        messageId,
        pixelCount: validation.pixels.length,
      });
    } catch (err) {
      await span('publish_failed');
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'Failed to publish draw event',
          correlationId,
          error: err instanceof Error ? err.message : String(err),
          'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
        })
      );
      res.status(500).json({
        error: 'Failed to publish draw event to broker.',
        correlationId,
        traceId,
      });
    }
  };
}

// Entry point for the Functions Framework: publishes to the real Pub/Sub topic.
export const webDrawProxy = createDrawProxyHandler(new PubSubEventPublisher());
