/**
 * Web Draw Proxy Cloud Function.
 * Fulfills Issue #76, C07 §3.2 and ADR-0006.
 * 
 * Verifies token, validates pixel stroke batch, formats event envelope,
 * and publishes to Pub/Sub topic 'pixel-draw-events'.
 * Strictly zero direct storage writes.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from '@google-cloud/functions-framework';
import { validateDrawBatch } from './validator.js';
import { extractAndVerifyToken } from './auth.js';
import { EventPublisher, MockEventPublisher, EventEnvelope } from './publisher.js';

export interface PixelDrawData {
  userId: string;
  pixels: Array<{ x: number; y: number; color: string }>;
}

export function createDrawProxyHandler(publisher: EventPublisher, topicName = 'pixel-draw-events') {
  return async function webDrawProxy(req: Request, res: Response): Promise<void> {
    // 1. Only allow POST method
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
      return;
    }

    // 2. Correlation ID propagation
    const incomingCorrelationId = req.header('X-Correlation-ID');
    const correlationId = incomingCorrelationId && incomingCorrelationId.trim().length > 0
      ? incomingCorrelationId.trim()
      : randomUUID();

    res.setHeader('X-Correlation-ID', correlationId);

    // 3. User Authentication
    const authHeader = req.header('Authorization');
    const bodyToken = typeof req.body?.token === 'string' ? req.body.token : undefined;
    const auth = extractAndVerifyToken(authHeader, bodyToken);

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

    // 5. Build Event Envelope
    const event: EventEnvelope<PixelDrawData> = {
      id: randomUUID(),
      correlationId,
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      data: {
        userId: auth.userId,
        pixels: validation.pixels,
      },
    };

    // 6. Publish to Pub/Sub (Asynchronous pipeline, zero direct storage writes)
    try {
      const messageId = await publisher.publish(topicName, event);

      res.status(202).json({
        status: 'accepted',
        eventId: event.id,
        correlationId,
        messageId,
        pixelCount: validation.pixels.length,
      });
    } catch (err) {
      res.status(500).json({
        error: 'Failed to publish draw event to broker.',
        correlationId,
      });
    }
  };
}

// Default export for Google Cloud Functions Framework
const defaultPublisher = new MockEventPublisher();
export const webDrawProxy = createDrawProxyHandler(defaultPublisher);
