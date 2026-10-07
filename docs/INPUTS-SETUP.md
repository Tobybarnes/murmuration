# Using the inputs branch

Open **Sources** to choose the sample flock or your own sources. Each persistent item has one stable bird ID. A weather refresh or a music play changes the atmosphere without adding a permanent bird. This branch keeps dots so the data behavior is easy to compare with the original.

The public page starts with 36 fictional messages, conversations and documents. **Replay activity** demonstrates an arrival, a repeated delivery, a read, an agent reply and an archive. The repeated delivery keeps the same bird. **My sources** starts empty until you connect an item source. Connected weather and listening also affect the sample flock, labeled **sample items, live atmosphere**. This lets you try them before connecting an Inbox. Imported fixtures keep their own atmosphere so they can be replayed independently.

Run locally with `npm run dev`. `npm run check`, `npm test` and `npm run build` validate and package the static site. Vercel uses `vercel.json`, including the provider origins required by its content security policy.

## Gmail

This personal pilot uses Google's browser token flow. You supply a public OAuth client ID and authorize your own Inbox. The access token and fetched metadata stay in memory in the current browser tab. There is no client secret, refresh token, database or background worker.

1. In Google Cloud, enable the Gmail API and configure the OAuth consent screen for your personal test application. Add yourself as a test user.
2. Create a **Web application** OAuth client. Add the exact site's origin to **Authorized JavaScript origins**. Sources displays the current origin. For local development, use `http://localhost` and `http://localhost:5173` (adjust the port if needed).
3. Configure the `https://www.googleapis.com/auth/gmail.metadata` scope. Paste the public client ID into Sources, click **Load Google sign-in**, then **Connect Gmail**. A second click keeps the authorization popup inside a user gesture.
4. Complete Google's consent screen. The app fetches a complete Inbox snapshot and refreshes once a minute while visible. Unread messages have a centre dot, which clears when read; an item leaving the Inbox removes its bird.

Only account email, message ID, labels and internal date are requested. Subjects, senders, snippets, bodies and attachments are not requested. A failed page or an Inbox above 2,000 messages leaves the previous complete snapshot in place. Refresh tokens and Gmail history cursors are not used in this version; reconnecting fetches a complete current snapshot.

**Disconnect** clears the token and stops requests, keeping the last metadata in the tab. **Forget Gmail metadata** also removes those birds. **Revoke Google access** waits for Google's confirmation; if the token has already expired, remove access in your Google Account permissions or reconnect first. Reloading clears the session and metadata. Restricted-scope requirements still apply when distributing the app beyond a personal pilot.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [JavaScript authorization API](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Weather and listening

**Weather:** Search for a city and select the intended match. Open-Meteo needs no API key for its public, noncommercial service. The app refreshes every 15 minutes while visible; an observation expires after 30 minutes. Wind affects movement, cloud cover and daylight affect the canvas atmosphere, and clearing weather restores the local conditions. Location is chosen explicitly and is not saved across reloads. [Open-Meteo documentation](https://open-meteo.com/en/docs), [terms and limits](https://open-meteo.com/en/terms).

**Last.fm:** Enter your username and an API key from [Last.fm](https://www.last.fm/api/account/create). These values stay in memory. The adapter reads recent tracks every 30 seconds while visible; repeated scrobbles keep the same event IDs. Current listening expires after 90 seconds without a fresh report. Only listening sent to Last.fm can appear here. This is the first music adapter to try; it can be replaced when a preferred service is chosen. [Recent tracks reference](https://www.last.fm/api/show/user.getRecentTracks).

Rate-limited providers wait at least five minutes before another automatic request. Requests can be cancelled when disconnecting or changing a source. A background tab does not start new polling requests.

## X / Twitter

`server/x-connector.mjs` is a server-only adapter, excluded from the static build. This site sends no X requests. A future authenticated server host must supply a bearer token, a narrow query, an owner-authorization callback and `allowPaidRequests: true` after the feed and provider budget are agreed. There is no public bearer-token proxy.

Each poll makes at most one request for ten search results. A paginated response fails without advancing the caller's cursor, so posts are not silently skipped and there are no hidden billable page requests. The host must persist the cursor and enforce any spending cap through durable accounting or the provider. An in-memory counter would not enforce a serverless budget. [X pricing](https://docs.x.com/x-api/getting-started/pricing), [recent search](https://docs.x.com/x-api/posts/search/introduction).

## Fixtures and other sources

Use **Export visible metadata** for an example of the JSON format, or import a file under 1 MB with `version: 1`, an `items` array, optional `changes`, and optional `environment`. Each item needs `itemId`, `sourceId` and a category of `email`, `agents` or `other`. Use globally namespaced IDs and numeric revisions. Unsupported fields, including bodies and tokens, are discarded. Exported IDs and titles can still be personal; keep those files private.

Fixtures support documents, Slack and agent records without claiming those accounts are connected. Calendar, GitHub notifications, RSS and task changes can use the same boundary later. Consumer chat history and the particular Muse product need a supported integration route before live access can be added.

The store rejects stale revisions, protects source ownership, applies batches atomically and expires ambient observations. The host passes canonical records to `scene.sync(items, changes)` and atmosphere to `scene.setEnvironment(environment)`. Scene strategies and renderers never fetch account data.
