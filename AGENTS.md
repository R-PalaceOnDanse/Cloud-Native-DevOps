# Agent instructions

Rules every AI agent (Antigravity, Copilot, Codex…) **must** follow when contributing to this
repository.

## Commit conventions

| Prefix   | When to use                                              |
|----------|----------------------------------------------------------|
| `[ADD]`  | A new file, resource, feature, or dependency is added.   |
| `[EDIT]` | An existing file or resource is modified.                |
| `[FIX]`  | A bug or misconfiguration is corrected.                  |
| `[DEL]`  | A file, resource, or dependency is removed.              |

### Rules

1. **One commit per logical step.** Each commit must be atomic: one concern, easy to revert.
2. **Prefix first**, then a short English message — one sentence max, a few words in general.
   Example: `[ADD] Firestore database resource`.
3. **Always in English.**
4. **Reference the issue** in the commit body (not the title) when closing one:
   `Resolves #134`.

### Examples

```text
[ADD] Firestore database resource
[ADD] Snapshots bucket with lifecycle rule
[EDIT] Enable Firestore API in serverless stack
[EDIT] Document serverless storage in serverless.md
[FIX] Missing audience in OpenAPI gateway spec
[DEL] Remove deprecated hello function
```
