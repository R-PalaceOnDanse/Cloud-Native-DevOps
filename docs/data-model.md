# Data model

The rules of the pixel grid as they exist in code: its size, how a pixel maps to a tile, how things
are named, which colors are accepted, how a user is rate limited, and how a tile becomes an image.
Read by anyone who writes a worker, the pixel store or the frontend's tile loading.

The design decisions (a pixel per Firestore document, tiles as images in Cloud Storage, an epoch to
clear the grid, ordered writes per tile) are in
[ADR-0007](adr/0007-grid-data-model.md). This page describes what is implemented from them, and says
what is not.

**Status:** the pure rules below exist, are tested, and have no Google Cloud client in them. The
Firestore documents, the transactions, the Cloud Storage upload and the delta documents do **not**
exist yet (issues #51, #54 for the upload, #58).

The code is in `app/functions/src/grid/`, `app/functions/src/ratelimit/` and
`app/functions/src/render/`.

## The grid and its tiles

- The grid is **10000 × 10000 pixels**; a pixel is `(x, y)` with `0 ≤ x, y ≤ 9999` and the origin at
  the top left. Anything else is refused with a reason (`parsePixel`).
- It is cut into **tiles of 256 × 256 pixels**, so 40 × 40 = 1600 tiles. The tiles of the last
  column and the last row are smaller: the last one is 16 × 16 (`tileBounds`).
- `tileOf` gives the tile that contains a pixel, `localOf` its position inside that tile,
  `tilesCovering` the tiles a viewport touches (the part outside the grid is ignored).

## Identifiers

| Thing | Form | Example | Used for |
|---|---|---|---|
| Pixel | `x:y` | `10:20` | The id of a pixel document ([ADR-0007](adr/0007-grid-data-model.md)) |
| Tile | `tx_ty` | `12_7` | The key of a tile image, and the ordering key of the writes on that tile |

`parseTileId` refuses an id that is malformed or outside the 40 × 40 tiles.

## Colors

A color is `#rrggbb` in any case, or the name of one of **16 palette colors**, in any case. It is
stored in the canonical form `#rrggbb`, in lowercase (`parseColor`).

The palette: `white`, `lightgray`, `gray`, `black`, `red`, `orange`, `yellow`, `lime`, `green`,
`cyan`, `blue`, `navy`, `purple`, `magenta`, `pink`, `brown`. The values are in
`app/functions/src/grid/color.ts`; the choice of a fixed palette of this size is a decision of the
decisions log, and changing it is a normal pull request.

## Rate limit

`evaluateRateLimit` decides whether a user may draw a number of pixels now. It is a pure function:
the caller reads the user's state, calls it, and stores the new state **in the same transaction**,
which is what makes the counting safe when two draws arrive together (that transaction is part of the
pixel store, not yet written).

- **20 pixels per minute** by default; an admin can set another whole number per user, `0` meaning
  that the user may not draw (`parseLimit`, `resolveLimit`).
- **Fixed windows** aligned on whole minutes. The state is two numbers: the start of the window and
  the pixels used. A user can use the limit twice around a minute boundary; this is accepted to keep
  the state small.
- **All or nothing.** A brush stroke is accepted whole or refused whole, never cut. A refusal says
  how many pixels remain and, when waiting helps, in how many seconds the next window starts. A
  stroke larger than the limit itself gets a different reason, `larger_than_limit`, because waiting
  will not help.

## Tile images

`renderTile` draws one tile as a PNG: a background (white by default), then each painted pixel; the
pixels of other tiles are ignored and the last pixel written at a position wins. The image has the
size of the tile, so the edge tiles are smaller. `encodePng` is a small encoder on Node's `zlib`
(8-bit RGB, no filter), so the functions need no image library.

What is missing: reading the pixels of a tile from Firestore, regenerating the image when a pixel
changes, and uploading it to the private bucket behind the CDN.
