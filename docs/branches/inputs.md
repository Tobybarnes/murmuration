# Inputs branch brief

Plan checked against provider documentation on 7 October 2026. `feature/inputs` explores how real activity reaches the flock. `feature/realistic-birds` owns rendering; `feature/wires` owns landing, perches and scene movement. Based on the live dot visualizer at `bb0cf87`. No integrations are implemented or accounts connected by creating these branches.

## Shared data contract

Propose three separate records:

- **Items** represent things that persist: an email, document, saved post or conversation. Each gets one stable `itemId`, namespaced by owner, provider account and source ID. Both scenes preserve that identity and use it as `birdId`. Reading or editing an item updates its bird; archiving removes it from an Inbox view.
- **Events** describe changes: arrival, reply, document edit, completed agent task or a recorded music play. They can briefly disturb the flock. Deduplicate by source event ID or a documented composite key; polling the same play repeatedly must not create repeated movement.
- **Environment** holds current conditions: weather, daylight and listening state. Include `observedAt` and `expiresAt`; stale or stopped playback must clear. Weather and music change the atmosphere without continually adding birds.

Adapters provide an initial snapshot, incremental changes, a persisted sync cursor and disconnect. Reconcile missed events and reject stale updates. Ambient updates use the proposed `setEnvironment(environment)` method separately from item synchronization. The host forwards environment state to the active scene; adapters never call its renderer. The shared scene API is `sync(items, changes)`, `update(dtMs, simTime)`, `getFrame()`, `setEnvironment(environment)`, `resize(viewport)` and `dispose()`.

## Requested inputs

| Input | Practical first version and constraints |
| --- | --- |
| Gmail | One bird per Inbox message; read changes state, archive removes it. Use OAuth, an initial snapshot and history reconciliation. Pub/Sub notifications carry history IDs; they are not email counts. Renew watches before expiry and recover missed changes. Even `gmail.metadata` is restricted, so confirm the personal-use/distribution model before OAuth setup. [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) |
| Twitter/X | Start with one chosen feed: personal mentions, selected accounts, a list or a narrow search. Treat new posts as events unless explicitly saved as persistent items. Recent Search covers seven days. X now charges through usage credits; agree a spending cap before enabling requests. Activity webhooks can deliver posts and mentions; personal mention subscriptions require user OAuth. [Search](https://docs.x.com/x-api/posts/search/introduction), [Activity](https://docs.x.com/x-api/activity/introduction), [Pricing](https://docs.x.com/x-api/getting-started/pricing) |
| Weather | Start with a chosen city and cache updates for roughly 15 minutes. Map wind, cloud, precipitation and daylight to bounded environmental values. Open-Meteo’s free API requires attribution and is for noncommercial use within its limits. Display freshness and keep a calm fallback during outages. [Weather API](https://open-meteo.com/en/docs), [Usage limits](https://open-meteo.com/en/pricing) |
| Last.fm | Best first music candidate if listening already reaches a scrobbler. `user.getRecentTracks` returns dated plays and a now-playing flag, using an API key without user authentication for this method. It reflects what reaches Last.fm; it cannot observe unreported listening. [Recent tracks](https://www.last.fm/api/show/user.getRecentTracks) |
| Apple Music | Use authorized recently played tracks first. Personalized requests need a Music User Token alongside developer authorization. History does not establish reliable live state from the native Music app; validate a local bridge separately if immediate playback changes matter. [Track history](https://developer.apple.com/documentation/applemusicapi/get-v1-me-recent-played-tracks), [Authentication](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit) |
| Spotify | OAuth can expose currently playing and recently played metadata. Development apps require a Premium owner and allow up to five authorized users. Handle quotas and backoff. Spotify prohibits synchronizing recordings with visual media, so confirm policy fit before promising reactive visuals; listening history is the initial research target. [Playback](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track), [History](https://developer.spotify.com/documentation/web-api/reference/get-recently-played), [Development limits](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [Policy](https://developer.spotify.com/policy) |

## Other inputs worth trying

Prioritize a few sources with clear meaning:

- **Calendar:** Upcoming appointments become persistent items; a meeting starting becomes an event. [Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync)
- **Documents and Slack:** Selected documents keep stable birds; edits disturb them. Selected Slack messages or mentions arrive as items. Access follows granted permissions. [Drive changes](https://developers.google.com/workspace/drive/api/guides/push), [Slack events](https://docs.slack.dev/apis/events-api/)
- **GitHub:** Review requests remain until resolved; a merge or failed build briefly moves the flock. [Webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- **RSS:** New entries create a small arrival event; saved entries can remain as birds. Start with a few public feeds.
- **Agents:** Conversation or task IDs persist; replies and completions create events. Instrument an application we control first. Consumer Claude exports are historical input, not evidence of live chat access. Identify the exact Muse product before committing its adapter. [Claude exports](https://support.claude.com/en/articles/9450526-export-your-claude-data)

## First milestones and acceptance

1. Build recorded fixtures for all three record types. Replaying duplicates, reconnecting and changing scenes must preserve item IDs and counts. Expired environment data clears.
2. Connect weather, then one music source. Weather refreshes and repeated polls must not add birds or replay the same event.
3. Add Gmail behind sign-in, with encrypted server-side credentials, metadata-only storage and private snapshots. New, read and archived mail must reconcile correctly after an offline interval.
4. Add a narrowly scoped X pilot after choosing its feed and budget. Keep personal records out of public previews; support disconnect and metadata deletion for every private adapter.

Open decisions are the weather location, music provider, Inbox versus unread mail, X feed and spending limit, exact Muse product, and acceptable update delay. Start with Gmail, weather and one music source before expanding the shortlist.

Related work: [bird rendering](https://github.com/Tobybarnes/murmuration/tree/feature/realistic-birds) and [wires](https://github.com/Tobybarnes/murmuration/tree/feature/wires). Agree identity and environment records with both branches before connecting providers.
