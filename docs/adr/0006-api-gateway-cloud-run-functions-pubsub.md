# ADR-0006 — API Gateway, Cloud Run functions and Pub/Sub for the entry path

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

Every public entry point must go through an API Gateway, functions must never be invokable
directly from the internet, and all real work flows through a message broker (subject §3.1,
C05 §3–§4, C06 §3). Discord requires an initial response within 3 seconds, and its interaction
tokens stay valid for 15 minutes for follow-up messages.

## Options considered

1. **Google Cloud API Gateway in front of Cloud Run functions, with Pub/Sub** — the wording of the
   subject. Per Google's documentation, API Gateway supports Cloud Run backends and streaming
   (WebSocket, SSE) with explicit configuration, with a request timeout up to 3600 s for
   streaming-enabled gateways and 15 s by default otherwise.
2. **Cloud Endpoints (ESPv2)** — more flexible, but a container to run and update.
3. **External HTTPS load balancer in front of Cloud Run** — full control, but a fixed cost and a
   less direct fit with "API Gateway or equivalent".

## Decision

Option 1. Functions are Cloud Run functions (2nd generation) running under a dedicated service
account each. Only the gateway's service account has `run.invoker` on the proxy functions;
workers are private and reached by Pub/Sub push subscriptions. Pub/Sub is the broker, with topics
such as `pixel.draw`, `discord.command` and `snapshot.requested`, a dead-letter topic for each
subscription, and idempotent consumers. Eventarc is used only for the "object created in the
snapshot bucket" event.

## Consequences

- Positive: matches the subject and the defense checklist; everything is private by default.
- Negative / trade-offs accepted: the gateway is configured through an OpenAPI file; a
  misconfigured streaming route would break the real-time path if ADR-0008 ever falls back to SSE.
- To verify before implementing: that the gateway forwards the raw request body unchanged, which
  the Discord signature check requires; and Pub/Sub ordering-key behaviour used in ADR-0007.
- Follow-up work: a first function behind the gateway is the first section 3 issue.
