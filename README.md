# Marketplace Alert

Local personal application that monitors Facebook Marketplace for products matching
user-created alerts (product name, city, maximum price).

## Stack

- **Frontend:** React + Vite + TypeScript (`web/`)
- **Backend:** Node.js + TypeScript + Express (`server/`)
- **Data:** PostgreSQL and Redis, both via Docker Compose (development only)

## Prerequisites

- Node.js 18+
- npm 10+
- Docker with Docker Compose
- Playwright Chromium (installed once, see below)

## Getting started

```bash
cp .env.example .env

# start PostgreSQL and Redis
docker compose up -d

# install dependencies (npm workspaces)
npm install

# download the Chromium browser used by Playwright (once)
npx playwright install chromium

# run backend (http://localhost:3000)
npm run dev:server

# run frontend (http://localhost:5173)
npm run dev:web
```

Open http://localhost:5173 to manage alerts (create, edit, delete). The dev
server proxies `/api` to the backend on port 3000.

## Scripts

| Script                 | Description                          |
| ---------------------- | ------------------------------------ |
| `npm run dev:server`   | Start the backend in watch mode      |
| `npm run dev:web`      | Start the frontend dev server        |
| `npm run build`        | Build backend and frontend           |
| `npm run typecheck`    | TypeScript checks for both workspaces|
| `npm run db:migrate --workspace server`  | Apply pending SQL migrations |
| `npm run db:check --workspace server`    | CRUD smoke test for alerts   |
| `npm run redis:check --workspace server` | Temporary product storage smoke test |
| `npm run browser:check`                  | Browser/session smoke test (reuse + login detection) |
| `npm run browser:login`                  | Manual Facebook login window (session is persisted) |
| `npm run scrape:check`                   | Scraper smoke test (parsing assertions + live search) |
| `npm run telegram:check`                 | Telegram notification smoke test (mocked API, no real messages) |
| `npm run retry:check`                    | Telegram retry/classification test (mocked API, no real messages) |
| `npm run cycle:check`                    | Cycle integration test (real Redis/Postgres, Telegram mocked) |

## Database

PostgreSQL runs in Docker Compose. Apply migrations before using any feature that
touches the database:

```bash
npm run db:migrate --workspace server
```

Migrations live in `server/migrations/*.sql`, are applied in order and tracked in
the `schema_migrations` table.

Redis also runs in Docker Compose and needs no setup; temporary products are
stored under the keys `alert:{alertId}:products`.

## Facebook session

The backend opens a persistent Playwright browser on startup, navigates to
Facebook Marketplace and keeps the context alive for later runs. Cookies live
in `.browser-profile/` (gitignored), so the session survives restarts.

If Facebook asks for authentication, log in manually in the opened window
(or run `npm run browser:login` with the backend stopped). Credentials are
never stored in `.env` and are never automated.

| Variable            | Default           | Description                                  |
| ------------------- | ----------------- | -------------------------------------------- |
| `BROWSER_HEADLESS`  | `false`           | `true` runs the browser without a window      |
| `BROWSER_USER_DATA_DIR` | `<repo>/.browser-profile` | Persistent profile directory       |
| `CRON_SCHEDULE`     | `*/15 * * * *`    | Cron expression for the scraping cycle       |
| `TELEGRAM_BOT_TOKEN` | *(empty)*         | Telegram bot token from @BotFather; empty disables notifications |
| `TELEGRAM_CHAT_ID`  | *(empty)*         | Destination chat/channel id; empty disables notifications |

Only one process can use the profile at a time; stop the backend before running
`browser:login`/`browser:check`.

## Scraper

`scrapeAlert(alert)` (`server/src/modules/scraper/`) searches Marketplace for
the alert's product name, keeps only listings whose location matches the alert
city and whose price is at most `maxPrice`, and returns `Product[]`. Search
results depend on the profile's Marketplace location (see `.browser-profile`),
so an alert for a city far from that location legitimately returns 0 products —
there is no radius or coordinate search. With a logged-out session, seller is
always an empty string and prices stay in the profile's currency (no
conversion). Untrustworthy runs (login wall, unusable page, all detail pages
failing) throw `ScrapeError` with the `alertId` so a scheduler can isolate them;
empty results simply return `[]`.

```bash
npm run scrape:check   # parsing assertions + live search against the real page
```

## Scheduler

The backend runs a scraping cycle every 15 minutes (node-cron, expression in
`CRON_SCHEDULE`). Each cycle clears the previous temporary products, loads all
alerts from PostgreSQL, scrapes them sequentially in a single browser tab,
isolates per-alert failures,
filters by city and maximum price, deduplicates and saves the results to Redis.
A cycle that is already running skips overlapping triggers (in-memory lock).

During development, trigger the same cycle manually instead of waiting for the
cron (it does not replace it):

```bash
curl -X POST http://localhost:3000/api/scheduler/run
# 200 {"data":{"cycleId":1,"trigger":"manual",...,"results":[...]}}
# 409 {"error":"cycle already running"}
```

## Telegram notifications

Optional: when a cycle finds new products the backend can send them to a
Telegram chat. Configuration is read from `.env` (see the table above); with
both variables empty the backend starts normally and logs
`telegram notifications: disabled (not configured)`.

Manual setup (no part of this is automated):

1. In Telegram, open a chat with **@BotFather** and send `/newbot`. Choose a
   display name and a username ending in `bot`. BotFather replies with the
   **bot token** (`<bot_id>:<secret>`) — treat it like a password: it goes
   only into your local `.env`, never into source files, logs, or commits.
2. Open a chat with your new bot and send `/start` — a bot cannot message you
   before you start a conversation with it.
3. Find your **chat id**: send any message to your bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in the browser (replace
   `<TOKEN>` with your token) and read `message.chat.id`. Ids are positive for
   private chats and negative for groups; for a public channel you can use its
   `@username` instead.
4. Copy the two variables into your local `.env` (start from `.env.example`):

   ```bash
   TELEGRAM_BOT_TOKEN=123456789:your_token_from_botfather
   TELEGRAM_CHAT_ID=123456789
   ```

5. Restart the backend — configuration is read at startup. The log line
   `[config] telegram notifications: enabled` confirms it.

`.env` is listed in `.gitignore`; keep credentials there and never paste them
into issues, docs, or commits.

Manual verification (you run this yourself against your own chat — the
automated checks above never send real messages or scrape Facebook):

1. Start the backend (`npm run dev:server`) and confirm
   `[config] telegram notifications: enabled` in the log.
2. Send `/start` to your bot once and then any message to it — a bot may only
   message you after you have started the conversation.
3. Trigger a cycle with `curl -X POST http://localhost:3000/api/scheduler/run`
   (the same run the scheduled cron performs), or wait for the next
   15-minute run.
4. In your chat, check the new products: an album (up to 10 photos) or a
   single photo, each caption with the heading, price, location and a
   working **Open listing** link to the original listing. If Telegram cannot
   download a Marketplace image URL, that product is delivered as a text
   message with the same details and link instead.
5. Trigger another cycle while nothing changed — the log reports
   `notification":{"status":"skipped"}` and no message arrives.

Delivery behavior (every 15-minute cycle):

- Each cycle sends **one** logical message with all newly found products
  across all alerts; a cycle with nothing new sends nothing.
- Each product is announced once: announced ids are remembered in Redis under
  `notified:products`, which is separate from the per-cycle product snapshot
  (`alert:*:products`) that is cleared on every run.
- Delivery is **at-least-once, never exactly-once**: if Telegram accepts a
  request but the backend loses the response, the same batch may be repeated
  in the next cycle. A Telegram outage never stops the scraping cycle — the
  batch is simply retried on the next run.

Retry behavior (bounded, inside the same cycle):

- Each message part gets at most **3 attempts** with a fixed 1s delay between
  them; total retry waiting never exceeds 60s per notification, so retries
  cannot block the next scheduled cycle.
- Permanent errors are never retried pointlessly: an invalid token/chat id
  (`auth`) and invalid message data (`bad_request`) fail immediately. A `429`
  honors Telegram's `retry_after` up to 5s and defers longer rate limits to
  the next scheduled cycle.
- When only part of the notification was delivered, the products Telegram
  confirmed are recorded right away and only the rest is retried next cycle.
  A timeout or lost response *after* Telegram may already have accepted the
  message stays ambiguous and can produce a duplicate — delivery remains
  at-least-once, never exactly-once.
- Final failures are logged as `[telegram]`/`[notify]` lines with the
  operation, attempt number, error category and batch size — never tokens,
  chat ids, or message payloads.

## Health check

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## API

All responses are JSON. Success: `{ "data": ... }`.

| Method | Path             | Success         | Errors |
| ------ | ---------------- | --------------- | ------ |
| GET    | `/api/alerts`    | `200` list      | — |
| POST   | `/api/alerts`    | `201` created   | `400` validation |
| GET    | `/api/alerts/:id`| `200` alert     | `400` invalid id, `404` not found |
| PUT    | `/api/alerts/:id`| `200` updated   | `400`, `404` |
| DELETE | `/api/alerts/:id`| `200` deleted   | `400`, `404` |
| GET    | `/api/products`  | `200` product list (current Redis state, newest first) | — |
| POST   | `/api/scheduler/run` | `200` cycle summary | `409` cycle already running |

```bash
curl -X POST http://localhost:3000/api/alerts \
  -H 'Content-Type: application/json' \
  -d '{"productName":"iPhone 13","city":"Bauru","maxPrice":2000}'
```

Errors use `{ "error": "..." }` (with `details` for validation failures);
unexpected server errors return a generic `500 {"error":"internal server error"}`.

## Documentation

- `docs/PROJECT_SPEC.md` — product and technical specification
- `docs/ARCHITECTURE.md` — architecture decisions


readme