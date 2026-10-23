# Discord application

The Discord application that the bot and the web login use: what was created, which values are
public and which are secret, where each one lives, and what remains to do. Read by anyone who
touches the Discord proxy, the command registration or the OAuth2 login.

## The application

Created on 2026-10-23 in the [Discord developer portal](https://discord.com/developers/applications)
by a team member, with a bot, and installed in a private test server. The application ID and the
public key are not secrets: the public key only lets anyone check a signature, never create one.

| Value | Content | Use |
|---|---|---|
| Application ID, also the OAuth2 Client ID | `1563124060290949170` | Registering commands, building the OAuth2 login URL |
| Public key | `50d6480a57d642d18cdcc2b467d86ab09a2be80e3a65de39d82c46743c3bfd9a` | Verifying the signature of every interaction, in the signature check of the functions workspace |

When the first function that needs them is deployed, these two values move into the Terraform
variables of the serverless stack, and this table points there instead of repeating them.

## Secrets

Two values give control over the application and **must never be committed, pasted in an issue or
written in a document**:

| Secret | Use | Where it lives |
|---|---|---|
| Bot token | Calling the Discord API as the bot (follow-up messages, command registration) | Secret Manager, one secret per environment |
| OAuth2 client secret | Exchanging the OAuth2 code for the user's identity in the login callback | Secret Manager, one secret per environment |

Until the Secret Manager API is enabled and the secrets exist (issue #47), the two values are kept
by the team member who created the application, outside the repository. The plan:

1. The serverless stack enables the Secret Manager API and creates the **empty** secrets. Terraform
   never holds the values, so they are not in its state.
2. A member adds each value once, from their terminal, without it appearing in a file or in the
   shell history: `gcloud secrets versions add <secret> --data-file=-`, then paste the value and
   end the input.
3. Each function reads only the secrets it needs, through its own service account (least
   privilege).

If a value is ever shown where it should not be, reset it in the developer portal (*Bot → Reset
Token*, *OAuth2 → Reset Secret*) and add the new value as a new secret version.

## Slash commands

The commands are the ones the subject lists, and nothing else. They are defined as data in
`app/functions/src/discord/commands.ts`, which is the source of truth for names, parameters and
limits; this table only says what each one is for.

| Command | Parameters | Meant to | Who |
|---|---|---|---|
| `/draw` | `x`, `y` (0 to 9999), `color` (a name or `#rrggbb`) | Draw one pixel; rate limited | anyone |
| `/get` | none | Show the current canvas as an image | anyone |
| `/snapshot` | none | Save a timestamped image and share a signed link | admins |
| `/admin pause`, `/admin resume` | none | Stop or allow drawing, on the canvas as a whole | admins |
| `/admin clear` | none | Erase the whole canvas | admins |
| `/admin ratelimit` | `user`, `limit` (0 or more) | Set how many pixels a user may draw per minute | admins |

The commands are visible to everyone in the server. **Who is an admin is decided by the worker,
not by Discord**, so a hidden command cannot be mistaken for a protected one; how the worker
tells admins from others is not decided yet.

`registerCommands` sends the whole list to Discord with a *bulk overwrite*: the list replaces
whatever is registered, so running it twice changes nothing and a command removed from the code
disappears from Discord. Given a server ID it registers for that server only, which takes effect
at once and suits development; without it the commands are global. It takes the bot token as an
argument and never logs it. **What does not exist yet:** a script that calls it, and its run from
the pipeline (issue #49).

## The proxy

`handleDiscordRequest` (`app/functions/src/discord/proxy.ts`) is everything the Discord entry
function does, without any Google Cloud client in it, so it is tested with a fake publisher. In
order:

1. **Refuse** a request that has no signature headers or whose signature is not Discord's: status
   401, nothing parsed, nothing published.
2. **Answer the PING** with a PONG.
3. **Read the slash command.** Anything else, or an interaction that lacks what a worker needs, gets
   a private message ("not supported") and nothing is published.
4. **Build one event** ([events.md](events.md)): `/draw` becomes a `pixel.draw` event, every other
   command a `discord.command` event. The interaction token is carried in the event so that a
   worker can answer the user.
5. **Publish it**, then **acknowledge with a deferred response** (type 5), which Discord needs within
   3 seconds. The worker edits that response or posts a follow-up, within the 15 minutes that the
   token lives.

If publishing fails, the user gets a private message asking to try again and the failure is logged.
The response to a malformed `/draw` (missing a parameter) is also private. The proxy keeps a
correlation ID supplied in the `x-correlation-id` header when it has a safe shape, and creates one
otherwise; the ID is on the event and on every log line. The interaction token never appears in a
log line.

**What does not exist yet:** the function that wraps this (an HTTP handler that reads the
environment, builds the publisher and the logger), its deployment, the broker it publishes to, and
the API Gateway in front of it (issues #44, #45 and #46).

## Still to do

- **Interactions endpoint URL**: left empty on purpose. Discord checks the URL when it is saved
  by sending a signed PING, so it is set once the API Gateway and the proxy are deployed (issue
  #46).
- **OAuth2 redirect URL**: added when the frontend has an address (section 5).
- **Admin authorization**: the worker needs either a Discord role or an allow-list of user IDs to
  tell admins from other users; which one is not decided.

## Scopes and permissions

- Installation scopes: `applications.commands` and `bot`, with the bot permissions *Send Messages*
  and *Attach Files*.
- Privileged gateway intents (presence, server members, message content): all disabled, the bot
  never connects to the gateway.
- Web login scope: `identify` only; the user's Discord access token is never stored.
