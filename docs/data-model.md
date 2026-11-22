# Data Model and Chunking Specification

This document defines the Firestore NoSQL data schemas, chunking partitioning strategy, and rate-limiting algorithms for the collaborative pixel canvas. It resolves GitHub Issue **#140** and aligns with **Epic #146**, **ADR-0007**, and **project_steps.pdf (C06 §4.3 & §5)**.

---

## 1. Grid Dimensions & Partitioning Strategy

### Dimensions
- Total canvas size: **10,000 × 10,000 pixels**.
- Coordinate range: `x ∈ [0, 9999]`, `y ∈ [0, 9999]`. Origin `(0, 0)` is at the top-left corner.
- Total potential pixel count: **100,000,000 pixels**.

### Why Chunking is Required
- **Hard Limit**: Google Cloud Firestore imposes a strict limit of **1 MiB per document**.
- **Pitfall**: Storing the entire grid in a single document (or large megabyte blobs) fails immediately and is flagged as an anti-pattern in the module guidelines (C06 §4.3 & §5).
- **Chunk Size**: The grid is divided into **64 × 64 pixel chunks**.
  - 1 Chunk = 4,096 pixels maximum.
  - With ~35 bytes per pixel (`color`, `author`, `timestamp`), a fully painted chunk occupies ~143 KiB, comfortably under the 1 MiB limit.
  - Number of chunks across the grid: `157 × 157 = 24,649 chunks` (`chunk_0_0` to `chunk_156_156`).
  - Storage is **sparse**: unpainted pixels do not occupy document space.

---

## 2. Coordinate Mapping Formulas

For any global canvas point `(x, y)`:

$$\text{chunkX} = \lfloor x / 64 \rfloor, \quad \text{chunkY} = \lfloor y / 64 \rfloor$$
$$\text{localX} = x \pmod{64}, \quad \text{localY} = y \pmod{64}$$

- **Chunk ID**: `chunk_{chunkX}_{chunkY}` (e.g. `chunk_42_15`)
- **Pixel Key within Chunk**: `{localX},{localY}` (e.g. `12,34`)

Inverse mapping back to global coordinates:
$$x = \text{chunkX} \times 64 + \text{localX}$$
$$y = \text{chunkY} \times 64 + \text{localY}$$

Implemented and tested in `app/common/src/coordinates.ts`.

---

## 3. Firestore Document Schemas

### A. Collection `chunks` (Pixel Grid State)
- **Path**: `chunks/{chunkId}` (e.g., `chunks/chunk_0_0`)
- **Document Schema**:
  ```json
  {
    "chunkId": "chunk_0_0",
    "chunkX": 0,
    "chunkY": 0,
    "pixels": {
      "0,0": {
        "color": "#ff0000",
        "author": "123456789012345678",
        "timestamp": 1700000000000
      },
      "12,34": {
        "color": "#00ff00",
        "author": "987654321098765432",
        "timestamp": 1700000005000
      }
    },
    "updatedAt": 1700000005000
  }
  ```

### B. Collection `rate_limits` (Per-user Rate Limiting)
- **Path**: `rate_limits/{userId}` (where `userId` is the Discord snowflake ID)
- **Document Schema**:
  ```json
  {
    "userId": "123456789012345678",
    "tokens": 18.5,
    "lastRefill": 1700000000000,
    "overrideLimit": null,
    "updatedAt": 1700000000000
  }
  ```
- **Rules**:
  - Default rate limit: **20 pixels per minute** per user.
  - Refill algorithm: Continuous token bucket based on elapsed time.
  - `overrideLimit`: Set by `/admin ratelimit <user> <limit>` to adjust quotas.

### C. Collection `session` (Canvas Control)
- **Path**: `session/state` (singleton document)
- **Document Schema**:
  ```json
  {
    "paused": false,
    "updatedBy": "123456789012345678",
    "updatedAt": 1700000000000
  }
  ```
- **Rules**:
  - Controlled by `/admin pause` and `/admin resume`.
  - When `paused: true`, all `/draw` and frontend write operations are rejected immediately.

---

## 4. Local Testing & Verification ($0 Cloud Spend)

The entire data model and coordinate translation logic is fully unit-tested with 0 cloud dependencies:

```bash
cd app/common
npm install
npm test
```
