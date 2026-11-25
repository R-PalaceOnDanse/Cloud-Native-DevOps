# Structured Logging and Correlation ID Tracing (Issue #89)

This document describes the structured logging standard, log correlation, sensitive credential redaction, and saved Cloud Logging queries fulfilling GitHub Issue **#89** and aligning with **ADR-0006** and **docs/events.md**.

---

## 1. Structured Logging Standard

Every serverless function (`web-draw-proxy`, `draw-worker`, `auth-callback`, `discord-proxy`) writes single-line JSON logs to stdout/stderr. Google Cloud Logging automatically ingests these JSON payloads into `jsonPayload`.

### Mandatory Structured Fields
Each log line includes:
- `severity`: Log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`).
- `timestamp`: ISO 8601 UTC timestamp.
- `functionName`: Name of the emitting Cloud Function.
- `correlationId`: UUID v4 propagated across all hops from the client through API Gateway, proxies, broker, and workers.
- `eventId`: Optional unique UUID v4 of the event envelope.
- `eventType`: Optional event classification (`pixel.draw`, `discord.command`, `snapshot.requested`).
- `message`: Clear human-readable description of the operation.

Example Log Line:
```json
{
  "severity": "INFO",
  "timestamp": "2026-11-23T12:00:00.123Z",
  "functionName": "draw-worker",
  "correlationId": "8f8b3c82-411a-4286-9a57-08412613da6f",
  "eventId": "b3c95a28-6e54-4a52-b88d-71b31526a419",
  "eventType": "pixel.draw",
  "message": "Draw event applied transactionally to chunk",
  "chunkId": "chunk_10_20",
  "pixelCount": 3
}
```

---

## 2. Sensitive Credential & Token Redaction

In accordance with strict security standards, functions must never write authorization credentials, Discord bot tokens, OAuth codes, client secrets, or user signatures to Cloud Logging.

The `StructuredLogger` automatically intercepts and redacts:
- Keys matching sensitive patterns (`token`, `secret`, `password`, `authorization`, `signature`, `cookie`, `code`).
- Values formatted as HTTP `Bearer <token>`.
- Any raw secrets are replaced with `[REDACTED]`.

This behavior is enforced by automated tests in `app/common/src/logger.test.ts`.

---

## 3. Searching Logs by Correlation ID in Google Cloud Logging

To inspect the complete lifecycle of any request across all microservices (from the initial HTTP request at API Gateway / proxy, through Pub/Sub delivery, to Firestore transactional execution):

### Google Cloud Console Query
In the Google Cloud Logs Explorer (`https://console.cloud.google.com/logs/query`), paste:

```
jsonPayload.correlationId = "8f8b3c82-411a-4286-9a57-08412613da6f"
```

Or across all fields:
```
"8f8b3c82-411a-4286-9a57-08412613da6f"
```

### gcloud CLI Search
```bash
gcloud logging read \
  'jsonPayload.correlationId="8f8b3c82-411a-4286-9a57-08412613da6f"' \
  --project=teampasx-cloudnative-dev \
  --format="table(timestamp,severity,jsonPayload.functionName,jsonPayload.message)"
```

### Saved Query: Recent Draw Errors
```
resource.type="cloud_run_revision"
severity>=WARNING
jsonPayload.functionName=("web-draw-proxy" OR "draw-worker")
```
