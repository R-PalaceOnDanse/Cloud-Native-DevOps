# ADR-0018 — Spike: Firebase Hosting, Authentication and Firestore Rules with Terraform

- **Status**: Accepted
- **Date**: 2026-11-23
- **Deciders**: project owner, team review
- **Supersedes**: none
- **Resolves**: Issue #78 (Part of Epic #114 & #123)
- **Validates**: ADR-0008, ADR-0009

## Context

Issue #78 tasks the team with validating early whether the architectural decisions in [ADR-0008](0008-firestore-listeners-for-realtime.md) (real-time chunk deltas through Firestore listeners with zero polling) and [ADR-0009](0009-firebase-hosting-and-discord-oauth.md) (Firebase Hosting, Discord OAuth2 authorization code flow, and Firebase custom tokens) hold under Terraform and GitHub Actions pipeline automation.

Specifically:
1. Can Firestore security rules and Firebase Hosting configuration be managed via Terraform and CI/CD pipelines, or is there a gap?
2. Does a custom token minted by the backend function allow a client to read Firestore documents under security rules while strictly denying direct client writes?

## Spike Results & Verification

### 1. Firestore Security Rules Deployment via Terraform
- **Capability**: Fully supported. Terraform provides the `google_firebaserules_ruleset` and `google_firebaserules_release` resources.
- **Implementation**:
  - `infra/serverless/firestore.rules` specifies the security policy (default deny, authenticated read on `chunks/{chunkId}` and `config/{docId}`, all client writes denied).
  - `infra/serverless/firestore_rules.tf` provisions the ruleset and release linked to the default Firestore Native instance.
- **Validation**: Rules policy tested in Node.js unit tests (`app/frontend/src/rules.test.ts`), confirming that unauthenticated reads are rejected, authenticated reads are permitted, and all client writes are denied.

### 2. Custom Token Authentication Loop
- **Capability**: Fully supported.
- **Implementation**:
  - The `auth-callback` Cloud Function (`app/functions/auth-callback/`) exchanges Discord authorization codes for user identity (`identify` scope), discards the Discord access token immediately, and mints a 1-hour session token carrying `discord:<id>`.
  - The client exchanges the code via `handleOAuthReturn()` with anti-CSRF verification (`state`), sets the token in session storage, and invokes `signInWithCustomToken()`.
- **Validation**:
  - Tested in unit suites (`auth.test.ts`, `index.test.ts`) and end-to-end integration (`integration.test.ts`).
  - Read queries on `chunks/{chunkId}` succeed under `request.auth != null`. Client write attempts fail with permission denied.

### 3. Firebase Hosting & Pipeline Gap Analysis
- **Capability & Gap**:
  - Google Cloud provides `google_firebase_hosting_site` in Terraform for site provisioning.
  - However, pushing static web assets (`dist/`) directly within a Terraform apply step is an anti-pattern (large binaries in terraform state / provider upload limits).
  - **Resolution**:
    - Infrastructure definition: Site configuration, SPA routing (`** -> /index.html`), and cache control headers are declared in `firebase.json`.
    - Pipeline deployment: CI/CD workflow builds the Vite bundle (`npm run build`) and uploads the static artifact to Firebase Hosting CDN (or Cloud Storage static bucket behind CDN).

## Decision

ADR-0008 and ADR-0009 **hold completely**. No superseding decision or architectural alteration is required.

## Consequences

- Positive:
  - Clean separation: API Gateway protects write endpoints; Firestore security rules protect real-time read listeners.
  - Zero sensitive Discord tokens stored on servers or clients.
  - High performance: 60 FPS viewport rendering with event-driven delta updates and zero polling loops.
- Negative / Accepted trade-offs:
  - Deployment of static frontend assets is handled by the frontend CI pipeline rather than embedding binary assets into Terraform state.
