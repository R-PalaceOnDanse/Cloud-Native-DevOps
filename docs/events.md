# Events

The events that flow through the broker, the envelope that wraps them, the correlation ID that ties
one request together, and the structured logs every function writes. Read by anyone who produces or
consumes an event. The code is in `app/functions/src/events/`; the choice of Pub/Sub is in
[ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md) and the tracing goal in
[ADR-0010](adr/0010-native-gcp-observability.md).

**Status:** the types, the Pub/Sub message codec, the validation and the logger exist and are
tested. The topics, subscriptions and functions that use them do **not** exist yet (issues #44,
#45, #48 and #53); the producer and consumer columns below are the intended wiring, not a
description of deployed code.

## The envelope

Every event has the same envelope. The identifying fields travel as Pub/Sub **message attributes**,
so a subscription can filter on them and a log line can be written without parsing the payload; the
payload is the JSON **data** of the message.

| Field | Where | Content |
|---|---|---|
| `eventId` | attribute | UUID, unique per event. Consumers ignore an event whose ID they already processed. |
| `eventType` | attribute | One of the three types below |
| `correlationId` | attribute | Created by the proxy, copied unchanged by every later hop (see below) |
| `occurredAt` | attribute | ISO 8601 instant at which the event was created |
| `schemaVersion` | attribute | `"1"`. A message with another version is rejected, not guessed at. |
| payload | data | JSON, shape depending on `eventType` |

`createEvent` builds an envelope, `toPubsubMessage` turns it into data plus attributes, and
`parseEnvelope` does the reverse and **rejects** anything that does not fit: a missing or malformed
attribute, an unknown type, data that is not JSON, or a payload of the wrong shape. A consumer treats
a rejected message as a failure of the producer, logs the reason, and lets the dead-letter policy
take it. `decodePushBody` reads the body that a push subscription posts to a function
(`{ "message": { "data": "<base64>", "attributes": { … } } }`).

## Event types

| `eventType` | Meant for | Intended producer | Intended consumer |
|---|---|---|---|
| `pixel.draw` | One or several pixels to draw | the Discord proxy (for `/draw`) and the web proxy (for the brush) | the draw worker |
| `discord.command` | Any other slash command | the Discord proxy | the command worker |
| `snapshot.requested` | A request for a timestamped snapshot | the command worker, for `/snapshot` | the snapshot worker |

`snapshot.ready` is not an application event: it is the notification of an object created in the
snapshot bucket, handled by Eventarc ([ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md)).

### Payloads

`reply` lets a worker answer the user of a Discord interaction: the application ID and the
interaction token. **The token is a secret valid for 15 minutes: it is never logged.**

| Type | Fields |
|---|---|
| `pixel.draw` | `source` (`discord` or `web`), `userId`, `pixels` (non-empty array of `x`, `y` integers and `color` string), `reply` (optional, present for Discord) |
| `discord.command` | `commandName`, `subcommand` (optional), `options` (map of string, number or boolean), `userId`, `roleIds` (array of strings), `guildId` and `channelId` (optional), `reply` |
| `snapshot.requested` | `requestedBy`, `channelId`, `reply` |

The payload checks only the shape: whether a coordinate is inside the grid or a color is valid is a
rule of the draw worker, not of the envelope. The exact TypeScript types are in
`app/functions/src/events/types.ts`; this table is not a second source for them.

## Delivery

The following are the rules the code is written for. They become facts once the subscriptions are
deployed (issue #45).

- **At least once.** An event may arrive more than once and out of order: consumers are
  idempotent, using `eventId`.
- **Failures** are retried by the subscription, then sent to a dead-letter topic; nothing is dropped
  silently.
- **Ordering** of pixel writes on a tile is handled by the data model
  ([ADR-0007](adr/0007-grid-data-model.md)), not by the envelope.

## Correlation ID

A request is followed end to end by a single `correlationId`.

- The **proxy creates it** when a request enters: `resolveCorrelationId` keeps an ID supplied by the
  caller only if it matches `[A-Za-z0-9._-]{8,64}` (it ends up in logs, so a value with spaces or
  line breaks is replaced), otherwise it generates a UUID.
- Every event the proxy publishes carries it as an attribute, and every consumer copies it onto the
  events it publishes in turn.
- Every log line carries it as `correlation_id`.

Once the functions are deployed, searching Cloud Logging for one `correlation_id` is meant to return the whole path of a request.

## Logs

`createLogger` writes one JSON object per line to standard output, which Cloud Logging collects and
parses:

| Field | Content |
|---|---|
| `severity` | `DEBUG`, `INFO`, `WARNING` or `ERROR` |
| `message` | What happened, in a few words |
| `function` | Name of the function that wrote the line |
| `correlation_id` | Present as soon as the request has one |
| `timestamp` | ISO 8601 instant |
| other fields | Those the caller passes explicitly, for example `event_id`, `x`, `y` |

The reserved names cannot be overwritten by a field. A function logs **explicit fields**, never a
whole payload or request, so that interaction tokens and user data stay out of the logs. A child
logger (`logger.child({ event_id })`) adds fields to every line it writes.
