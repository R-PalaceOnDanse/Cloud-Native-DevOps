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

## Still to do

- **Interactions endpoint URL**: left empty on purpose. Discord checks the URL when it is saved
  by sending a signed PING, so it is set once the API Gateway and the proxy exist (issues #44 and
  #46).
- **OAuth2 redirect URL**: added when the frontend has an address (section 5).
- **Slash commands**: `/draw`, `/get`, `/snapshot` and the `/admin` subcommands are registered
  by a script from the pipeline (issue #49). During development they can be registered for the
  test server only, which takes effect immediately.
- **Admin authorization**: the worker needs either a Discord role or an allow-list of user IDs to
  tell admins from other users; which one is not decided.

## Scopes and permissions

- Installation scopes: `applications.commands` and `bot`, with the bot permissions *Send Messages*
  and *Attach Files*.
- Privileged gateway intents (presence, server members, message content): all disabled, the bot
  never connects to the gateway.
- Web login scope: `identify` only; the user's Discord access token is never stored.
