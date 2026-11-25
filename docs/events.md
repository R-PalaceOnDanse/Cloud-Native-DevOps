# Event Envelope and Pipeline Specification

This document defines the standard Pub/Sub event envelope, correlation ID propagation, and event schemas for the asynchronous event-driven pipeline, resolving GitHub Issue **#43** and aligning with **ADR-0006**.

---

## 1. Asynchronous Architecture & Decoupling

In accordance with module rules (C06 §3 & §4):
- **No direct storage writes**: Proxy functions (Discord proxy and Web Draw proxy) do **not** write to Firestore or Cloud Storage directly.
- **Fast acknowledgement**: Proxies validate input, authenticate the caller, publish an event to Pub/Sub, and immediately return `202 Accepted` (or deferred interaction for Discord).
- **Pub/Sub Topics**:
  - `pixel.draw`: Draw requests emitted by Web or Discord users.
  - `discord.command`: Administrative commands (`/admin pause`, `/admin resume`, `/admin ratelimit`).
  - `snapshot.requested`: Snapshot generation triggers.
  - `*-dead-letter`: Dead-letter topics for failed worker deliveries.

---

## 2. Event Envelope Schema

Every event published to Pub/Sub adheres to the typed `EventEnvelope<T>` schema defined in `@teampasx/common`:

```typescript
export interface EventEnvelope<T = unknown> {
  /** Unique UUID v4 for message deduplication and idempotent processing */
  readonly id: string;
  /** Correlation ID for end-to-end distributed tracing across all hops */
  readonly correlationId: string;
  /** Event classification: 'pixel.draw' | 'discord.command' | 'snapshot.requested' */
  readonly type: EventType;
  /** Source of origin: 'web' | 'discord' */
  readonly source: EventSource;
  /** Millisecond unix timestamp */
  readonly timestamp: number;
  /** Typed event payload */
  readonly data: T;
}
```

### Pub/Sub Message Attributes
For efficient routing, message filtering, and tracing, every Pub/Sub message includes attributes:
- `correlationId`: The correlation UUID string.
- `eventType`: The event type string (e.g. `pixel.draw`).
- `eventSource`: The origin string (`web` or `discord`).

---

## 3. Event Payloads

### `pixel.draw`
```json
{
  "id": "b3c95a28-6e54-4a52-b88d-71b31526a419",
  "correlationId": "8f8b3c82-411a-4286-9a57-08412613da6f",
  "type": "pixel.draw",
  "source": "web",
  "timestamp": 1700000000000,
  "data": {
    "userId": "123456789012345678",
    "pixels": [
      { "x": 1420, "y": 850, "color": "#ff0000" },
      { "x": 1421, "y": 850, "color": "#00ff00" }
    ]
  }
}
```

### `discord.command`
```json
{
  "id": "e6f81a72-1b3c-482a-9e12-3b2d184a81c4",
  "correlationId": "912384a1-b827-4a6c-bc19-182390a7b489",
  "type": "discord.command",
  "source": "discord",
  "timestamp": 1700000000000,
  "data": {
    "interactionId": "118239018239012",
    "commandName": "admin",
    "userId": "987654321098765432",
    "options": {
      "subcommand": "pause"
    }
  }
}
```
