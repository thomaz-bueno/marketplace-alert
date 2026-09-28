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
