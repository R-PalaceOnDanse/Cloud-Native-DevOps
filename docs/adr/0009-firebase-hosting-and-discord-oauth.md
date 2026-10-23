# ADR-0009 — Firebase Hosting and Discord OAuth2 with Firebase custom tokens

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The frontend must be hosted serverless, users log in with Discord OAuth2 with minimal scopes, and
the user's Discord access token must not be stored server-side (subject §3.4, C07 §3.1–§3.2).
Application buckets must not be public (C06 §4.1).

## Options considered

1. **Static site in a Cloud Storage bucket behind a load balancer and CDN** — serving a public
   website from a bucket conflicts with the "no public bucket" principle unless extra
   configuration is added.
2. **Firebase Hosting** — global CDN and HTTPS included, in the same project as Firestore.
3. **Cloud Run serving a container** — works, but is more to build and maintain for static files.
4. **Discord Activity** — runs inside Discord and needs its embedded SDK; useful as a bonus, not as
   the base.

## Decision

Firebase Hosting for the static frontend. Login uses the OAuth2 authorization code flow with the
`identify` scope. A callback function behind the API Gateway exchanges the code (the client secret
is read from Secret Manager), reads the Discord user id, discards the Discord token, and returns a
Firebase custom token for that user. The client signs in with it and uses it for Firestore
listeners (ADR-0008) and for gateway calls, where the gateway validates the token.

## Consequences

- Positive: a single identity for listeners and API calls; nothing sensitive stored.
- Negative / trade-offs accepted: Firebase Authentication and Hosting are enabled in the project;
  custom tokens expire after one hour, so the client must refresh the session.
- To verify before implementing: Terraform support for Firebase Hosting and Firebase
  Authentication; a short spike at the start of the frontend section decides, and a failure is
  recorded in a superseding ADR.
