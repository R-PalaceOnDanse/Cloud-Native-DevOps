/**
 * Event publisher: Pub/Sub in production, in memory in the tests.
 */

import { randomUUID } from 'node:crypto';

export interface EventEnvelope<T = unknown> {
  id: string;
  correlationId: string;
  type: string;
  source: string;
  timestamp: number;
  traceParent?: string | undefined;
  data: T;
}

export interface EventPublisher {
  publish<T>(topicName: string, event: EventEnvelope<T>): Promise<string>;
}

/** Publishes to the real topic. The attributes let a subscriber filter or trace without decoding. */
export class PubSubEventPublisher implements EventPublisher {
  private client: import('@google-cloud/pubsub').PubSub | undefined;

  async publish<T>(topicName: string, event: EventEnvelope<T>): Promise<string> {
    if (!this.client) {
      const { PubSub } = await import('@google-cloud/pubsub');
      this.client = new PubSub();
    }
    return this.client.topic(topicName).publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        correlationId: event.correlationId,
        eventType: event.type,
        eventSource: event.source,
        ...(event.traceParent ? { traceparent: event.traceParent } : {}),
      },
    });
  }
}

export class MockEventPublisher implements EventPublisher {
  public publishedEvents: Array<{ topic: string; event: EventEnvelope }> = [];

  public async publish<T>(topicName: string, event: EventEnvelope<T>): Promise<string> {
    this.publishedEvents.push({ topic: topicName, event: event as unknown as EventEnvelope });
    return randomUUID();
  }
}
