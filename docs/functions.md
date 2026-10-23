# Functions

The TypeScript workspace under `app/functions`, which holds the code of the serverless functions
(the Discord proxy, the workers). Read by anyone who writes or reviews function code. The choice of
language is in [ADR-0005](adr/0005-typescript-for-functions.md); the entry path they plug into is
in [ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md).

Today the workspace holds the first building blocks only: verifying Discord's request signature,
answering its PING, and the event envelope with its structured logger. No function is deployed yet.

## Layout

```
app/functions/
  package.json           scripts and dev dependencies (npm); package-lock.json pins them
  tsconfig.json          strict type checking, used by the editor, lint and tests
  tsconfig.build.json    the build: src/ to dist/, tests excluded
  eslint.config.js       strict, type-aware lint; `any` is an error
  src/discord/           Discord request handling
    signature.ts         Ed25519 verification over timestamp + raw body
    ping.ts              first step of the proxy: verify, answer PING, hand over the rest
  src/events/            event envelope, Pub/Sub codec and validation, structured logger (docs/events.md)
```

Tests sit next to the code they test, as `*.test.ts`.

## Commands

Run from the repository root; they use the Node version pinned by mise.

```bash
npm --prefix app/functions ci              # install exactly what package-lock.json says
npm --prefix app/functions run typecheck   # tsc --noEmit
npm --prefix app/functions run lint        # eslint, must report nothing
npm --prefix app/functions test            # vitest, once
npm --prefix app/functions run build       # emit app/functions/dist (ignored by git)
```

The workflow `.github/workflows/functions-ci.yml` runs the same five steps on every pull request
or push to `main` that touches `app/functions`.

## Conventions

- **Strict typing, no `any`.** `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`; ESLint's strict type-checked rules apply, and an explicit `any`
  fails the lint.
- **Validate at the boundary.** Input from Discord or from a message is `unknown` until it has
  been checked; nothing is parsed before the signature is valid.
- **Pure first.** Business rules are plain functions with no GCP client in them, so they are tested
  without cloud access. The code that talks to GCP is a thin layer on top.
- **Dependencies** are added with `npm install` in `app/functions`; `package-lock.json` is committed
  and CI installs with `npm ci`. A new dependency is a decision: say why in the pull request.
- The runtime is Node 22, as pinned in `.mise.toml` and in `package.json` (`engines`).

## Tools in the workspace

| Tool | Used for | Why |
|---|---|---|
| [TypeScript](https://www.typescriptlang.org/) | type checking and build | [ADR-0005](adr/0005-typescript-for-functions.md) |
| [Vitest](https://vitest.dev/) | unit tests | runs TypeScript and ES modules with no extra configuration; decisions log, 2026-10-23 |
| [ESLint](https://eslint.org/) with [typescript-eslint](https://typescript-eslint.io/) | lint, and the ban on `any` | enforces the typing rule of `CLAUDE.md`; decisions log, 2026-10-23 |
| npm | install and scripts | already installed with Node, so no new tool for the team; decisions log, 2026-10-23 |
