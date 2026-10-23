# ADR-0005 — TypeScript on Node.js for the serverless functions

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The functions validate Discord's Ed25519 signatures, split the grid into tiles, compose PNG
images and publish events. The frontend needs a language too, and the project rule is strict
typing with no `any`. Cloud Run functions list Node.js (24, 22, 20), Python (3.14 to 3.12) and Go
(1.26 to 1.24) among their runtimes; the GA or preview status of some versions is inconsistent
across Google's pages.

## Options considered

1. **TypeScript on Node.js** — the same language as the frontend, so types and code can be shared.
   Ed25519 verification is built into Node's `crypto` module (to confirm when implementing).
   PNG composition needs a library.
2. **Python** — Pillow makes images easy, but Ed25519 needs a dependency and typing is weaker.
3. **Go** — very small cold start and memory use, with Ed25519 and PNG in the standard library, but
   a second language next to the frontend.

## Decision

TypeScript in strict mode on Node.js for all functions and for the frontend. Every member must
be able to explain all the code at the defense, and one language makes that easier. Go stays the
fallback for a single function if cold-start latency of a function proves unacceptable, recorded
then in a new ADR.

## Consequences

- Positive: shared types between frontend and functions; a single toolchain and test runner.
- Negative / trade-offs accepted: slower cold starts than Go; an image library is required.
- Follow-up work: the Node version in `.mise.toml` (22 today) must be aligned with the runtime
  chosen for the functions, and the lockfile regenerated; the build and test commands go into
  `CLAUDE.md` when the first function lands. Team familiarity with TypeScript was not checked and
  is an assumption.
