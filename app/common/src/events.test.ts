import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createEventEnvelope } from './events.js';

describe('Event Envelope (Issue #43)', () => {
  it('creates a valid pixel.draw event envelope with unique UUIDs', () => {
    const envelope = createEventEnvelope('pixel.draw', 'web', {
      userId: 'user_123',
      pixels: [
        { x: 10, y: 20, color: '#ff0000' },
        { x: 11, y: 20, color: '#00ff00' },
      ],
    });

    assert.ok(typeof envelope.id === 'string' && envelope.id.length > 0);
    assert.ok(typeof envelope.correlationId === 'string' && envelope.correlationId.length > 0);
    assert.strictEqual(envelope.type, 'pixel.draw');
    assert.strictEqual(envelope.source, 'web');
    assert.ok(envelope.timestamp > 0);
    assert.strictEqual(envelope.data.userId, 'user_123');
    assert.strictEqual(envelope.data.pixels.length, 2);
  });

  it('preserves an existing correlation ID if provided', () => {
    const customCorrelationId = 'trace-abc-123';
    const envelope = createEventEnvelope(
      'pixel.draw',
      'discord',
      {
        userId: 'discord_456',
        pixels: [{ x: 50, y: 50, color: '#0000ff' }],
      },
      customCorrelationId
    );

    assert.strictEqual(envelope.correlationId, customCorrelationId);
    assert.strictEqual(envelope.source, 'discord');
  });
});
