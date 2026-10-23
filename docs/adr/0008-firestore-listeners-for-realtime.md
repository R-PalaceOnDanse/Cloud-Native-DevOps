# ADR-0008 — Real-time updates through Firestore listeners

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The canvas must update in real time through events or streaming; polling and refresh buttons are
forbidden, and only changed pixels should be transmitted (subject §3.4, C07 §3.3). C07 names
Firestore real-time listeners as an acceptable mechanism on GCP.

## Options considered

1. **Firestore real-time listeners** — no server to run. Each client is billed a read for each
   changed document it receives, so cost grows with the number of viewers.
2. **SSE or WebSocket on Cloud Run, behind the gateway** — fine control and minimal deltas.
   Google documents a request timeout of up to 60 minutes (clients must reconnect), billing of an
   instance as active while it holds an open connection, and session affinity that is only best
   effort. Fanning events out across instances needs extra design.
3. **Firebase Realtime Database as a push bridge** — cheap fan-out, but the subject names
   Firestore or DynamoDB as the NoSQL store, so compliance is uncertain.

## Decision

Option 1. Workers write delta documents (one per batch, per tile, per short interval) to a
dedicated collection, with a TTL so they expire. A client listens only to the deltas of the tiles
in its viewport, after loading those tiles from the CDN (ADR-0007). Security rules allow reads to
authenticated users and deny all client writes, which go through the gateway only.

The fallback, if reads cost too much or listener limits bite, is option 2 behind the gateway,
recorded in a new ADR.

## Consequences

- Positive: no connection-handling code; a draw from Discord and from the web follow the same path.
- Negative / trade-offs accepted: cost per viewer; reading requires the client to authenticate
  against Firebase (ADR-0009).
- To verify during implementation: the maximum number of tiles one client can listen to, and the
  cost of a load test with several viewers.
