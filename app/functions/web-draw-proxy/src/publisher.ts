/**
 * Event publisher for Pub/Sub.
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

export class MockEventPublisher implements EventPublisher {
  public publishedEvents: Array<{ topic: string; event: EventEnvelope }> = [];

  public async publish<T>(topicName: string, event: EventEnvelope<T>): Promise<string> {
    this.publishedEvents.push({ topic: topicName, event: event as unknown as EventEnvelope });
    return randomUUID();
  }
}
