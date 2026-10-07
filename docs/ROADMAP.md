# Murmuration roadmap

The first release recreates Ben Bashford’s JavaScript experiment, with dots, in an owned GitHub project hosted on Vercel. The work below is the future plan. It does not imply that any account is connected or that realistic birds and telephone wires already exist.

Build one collection of birds with two ways to show it. The sky scene lets those birds flock together; the wire scene gives them a place to land. Changing scenes should preserve which real item each bird represents.

## What a bird represents

Start with one bird per email message, document, agent conversation, or Slack message. A new reply in an agent conversation stirs its existing bird; it does not create a second conversation. An edit to a document moves the existing bird. Slack messages use their workspace, channel and message timestamp as their source identity. These are proposed defaults to confirm when each adapter is built.

Keep the item and its activity separate:

| Record | Minimum fields | Purpose |
| --- | --- | --- |
| Item | Owner, account, provider, source ID, kind, category, created/updated time, provider version, lifecycle, read state | The current truth about the item and its stable bird identity |
| Event | Provider event ID, item ID, event kind, source time, receipt time, source cursor/version | A change that updates an item and may cause a brief animation |
| Connection | Owner, provider account, encrypted credentials, sync cursor, watch expiry, last successful sync | Where to resume after a disconnect |

Categories map to the three wires: Email, Agents, and Other. Initially, Other can hold Slack and document activity; its final name can follow the sources chosen later. `readState` must allow `unknown`, because every source does not expose the same read information.

Use a unique item key across owner, account, provider and source ID. Deduplicate provider events separately. Apply changes in source version order where available; otherwise fetch current source state before applying a delayed event. Commit updated items and the sync cursor together. An old retry must never bring back an archived or deleted bird.

On first connection, fetch the selected items and then reconcile changes received during that fetch. Reconnecting reloads a snapshot and resumes from its cursor. The initial history fills the scene quietly; only newly received activity triggers arrival animations. Keep enough deletion records to prevent late events from resurrecting items.

## The two scenes

**Sky.** Preserve the flock’s alignment, separation and cohesion. Arrivals join from outside the frame and briefly disturb nearby birds. Existing items change their activity without resetting their positions. Items leaving the selected set fly out.

**Three wires.** Each category has one telephone wire. Birds approach, slow down, land in a stable perch, settle, and eventually take off. Use the same identities and event handling as the sky scene, with a different movement controller. Stable perch assignment prevents a whole wire from shuffling whenever one email arrives.

For the first email version, use Inbox membership: an incoming email lands, reading it changes its appearance subtly, and archiving it makes it leave. These are observed changes from the mail account. The visualizer does not need permission to mark mail read or archive it. For sources without an inbox, choose an explicit recent-activity window so birds do not accumulate forever.

A full wire needs a clear capacity rule. Keep one real item per visible bird, select a bounded set, and expose the shown count and total count unobtrusively. Never turn ten emails into one ordinary-looking bird or silently present the visible count as the complete inbox.

## From dots to birds

First replace dots with small directional silhouettes, with heading derived from velocity and slightly different wing phases. Keep the current movement underneath. Then add curved flight paths, banking, gliding, depth and variation in wingbeats. The wire scene also needs recognisable perched poses and convincing landing and takeoff transitions.

Start with Canvas and a small sprite atlas or procedural silhouettes. Profile before moving to instanced WebGL for larger flocks or richer birds. Keep simulation data separate from drawing so both renderers can use the same birds. Use a spatial grid for neighbour searches, a fixed simulation step, a capped device pixel ratio, and pause work in hidden tabs. Reduced-motion mode should retain an intelligible scene with calmer or static movement.

Suggested acceptance targets are smooth motion at 1,000 simple birds on the chosen desktop and 300 on the chosen phone, with those exact devices recorded. These are targets to measure, not current performance claims. Lower visual detail before compromising item identity.

## Connecting real activity

Each adapter should support an initial snapshot, incremental changes, renewal/reconciliation, and disconnect. Use a recorded event fixture to develop both scenes before requesting access to private accounts.

| Source | Proposed integration | Constraint to handle |
| --- | --- | --- |
| Email | If Gmail is chosen, OAuth plus an initial mailbox snapshot, Gmail history, and Cloud Pub/Sub notifications | A notification supplies a history cursor, not an email. Renew the watch, reconcile missed notifications, and perform a new snapshot if history has expired. [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push), [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync) |
| Documents | If Google Docs is chosen, watch selected Drive files or the Drive change feed and fetch changed metadata | Drive notifications have empty bodies; channels expire and need replacement. A file change updates one document bird. [Drive notifications](https://developers.google.com/workspace/drive/api/guides/push) |
| Slack | Install a Slack app with only the required read scopes and selected conversations; receive HTTP Events API callbacks | Access follows granted scopes and visibility. Verify signatures, persist the event, acknowledge within three seconds, and process retries idempotently. [Events API](https://docs.slack.dev/apis/events-api/), [Request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/) |
| Claude | For a chat application we control, emit events around its API requests and responses. Use a user-requested export for a historical consumer-chat import | Claude’s documented Messages API generates responses from supplied conversation history. The consumer export is a separate flow. Do not promise that an API key can observe existing claude.ai chats in real time. [Messages API](https://platform.claude.com/docs/en/api/messages/create), [Claude exports](https://support.claude.com/en/articles/9450526-export-your-claude-data) |
| Muse | Identify the exact product, then inspect its supported export, API, webhook or local event interface | “Muse” is not specific enough to select an integration. A live connection remains uncommitted until there is a supported source of events. |

No provider should be treated as perfectly reliable. Reconcile after missed events, handle rate limits with backoff, renew subscriptions before expiry, and show when a connection has stopped updating. Read and archive behaviour belongs to each adapter; do not infer Slack read status or a document inbox from activity alone.

## Hosting and private data

Keep the visualizer on Vercel. Future Vercel Functions can receive webhooks, complete OAuth flows, return private snapshots and process short sync jobs. Store items, cursors and an event outbox in a durable database; use a durable queue for work acknowledged before processing. A scheduled job renews watches and reconciles missed changes. Animation stays in the browser.

Start with authenticated polling for private scene updates. Add server-sent events if the delay is noticeable; this scene mostly needs updates flowing from the server to the browser. Vercel also supports native WebSockets in public beta, but a connection ends with its Function and a reconnect can reach a different instance. Persist state outside the Function and resume with a cursor whichever transport is used. [Vercel WebSockets and SSE](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

Store source IDs, category, timestamps and necessary state first. Email bodies, chat text, document contents and subjects are unnecessary for this ambient view. Keep OAuth refresh tokens encrypted on the server, verify incoming requests, and isolate every query by the signed-in owner. Public demos and preview deployments use fixtures. A disconnect revokes access where supported and offers deletion of that connection’s stored metadata.

Gmail’s metadata scope is still classified as restricted. Confirm the personal-use or distribution model before implementing OAuth, including any applicable verification and security-assessment requirements; reading less data does not make those requirements disappear. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

## Delivery order

1. **Recreation.** Publish the attributed dot experiment from GitHub to Vercel, with the source provenance recorded. Verify visible animation, controls, resize behaviour and touch interaction on the live URL.
2. **Shared state and two scene prototypes.** Build the item/event model and a fixture covering arrival, reply, read, archive, deletion, duplicates and out-of-order delivery. Switching sky/wires and replaying the fixture must preserve identities and counts. Keep dots or simple silhouettes while proving the behaviour.
3. **Email pilot.** Connect one chosen personal account with minimum read access. An incoming message adds exactly one bird; reading preserves it; archiving removes it. Reload, duplicate webhook delivery, expired credentials and an offline interval must recover to the source’s current state.
4. **Bird movement and rendering.** Develop flight and perched silhouettes into believable birds. Verify landing, takeoff, scene transitions, reduced motion and the measured desktop/phone budgets with the same item fixtures.
5. **Additional adapters.** Add the selected document source and Slack, then the supported Claude/Muse route. Each adapter must pass the same identity, reconnect and deletion checks. Verify that disconnecting it removes access and that private records never appear in the public demo.

Before starting the email pilot, choose the mail provider, the exact Muse product, and whether the first email view represents the Inbox or only unread mail. The proposed starting point is Inbox, with Email / Agents / Other as the three wires.
