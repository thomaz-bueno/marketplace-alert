# Marketplace Alert — Architecture

## High-level diagram

```
                         ┌───────────────────┐
                         │   React + Vite    │
                         └─────────┬─────────┘
                                   │ HTTP
                                   ▼
                         ┌───────────────────┐
                         │ Express + Node.js │
                         │    TypeScript     │
                         └───────┬─────┬─────┘
                                 │     │
                 ┌───────────────┘     └───────────────┐
                 ▼                                     ▼
        ┌─────────────────┐                   ┌─────────────────┐
        │   PostgreSQL    │                   │      Redis      │
        │     alerts      │                   │ temp. products  │
        └─────────────────┘                   └────────▲────────┘
                                                       │
                                                ┌──────┴──────┐
                                                │  Playwright │
                                                │   Scraper   │
                                                └──────┬──────┘
                                                       │
                                                       ▼
                                              Facebook Marketplace
```

The scheduler runs inside the same Node.js process as Express. There is a single
backend process in the MVP.

## Repository layout

```
marketplace-alert/
├── web/                    # React + Vite frontend
│   └── src/
│       ├── api/alerts.ts   # typed fetch client for /api/alerts
│       ├── components/     # AlertList, AlertForm (presentational)
│       ├── App.tsx         # dashboard state orchestration
│       └── index.css       # plain CSS, responsive
├── server/                 # Express backend
│   ├── migrations/         # numbered .sql migration files
│   └── src/
│       ├── config/         # environment/config loading
│       ├── modules/        # alerts, products, scraper, scheduler (done); notifications (later)
│       ├── infrastructure/ # postgres, redis, browser/session (playwright)
│       ├── scripts/        # helpers: migrate, check-alerts, check-products,
│       │                     # check-browser, check-scraper, login-facebook
│       ├── app.ts          # Express app factory (no listen)
│       └── server.ts       # process entrypoint (listen)
├── docs/
├── docker-compose.yml      # PostgreSQL + Redis only
├── .env.example
├── .gitignore
├── README.md
└── package.json            # npm workspaces (server, web)
```

Folders are created only when there is meaningful code for them.

## Decisions

### Stage 1 — project foundation (done)

- **npm workspaces**: `server` and `web` are independent workspaces under one root
  `package.json`. Keeps frontend/backend runnable and type-checked independently
  without extra tooling.
- **Docker only for data**: PostgreSQL 16 and Redis 7 run in Docker Compose; Node
  and Vite run on the host in development.
- **`app.ts` / `server.ts` split**: `createApp()` builds the Express app (testable,
  no side effects); `server.ts` is the only file that calls `listen()`.
- **Config module**: `server/src/config` reads `.env` (via `dotenv`) with typed
  defaults, so later stages (Postgres/Redis connections) reuse the same source.
- **Dev tooling**: `tsx watch` for backend development, `tsc` for type checking and
  production build, Vite for the frontend.
- **Module system**: CommonJS on the backend to keep imports extension-free and
  the build simple; ESM on the frontend via Vite.
- **Ports**: backend `3000`, frontend `5173`, Postgres `5432`, Redis `6379`
  (overridable through `.env`).
- **Root `.env`**: workspace scripts run with `cwd = server/`, so `config` loads
  `.env` from the process cwd first, then from the repository root.

### Stage 2 — PostgreSQL + Alerts (done)

- **Access approach: `pg` (node-postgres) with a single `Pool`.** No ORM and no
  repository framework — the project has one table and simple queries; a thin
  typed layer is enough and avoids unnecessary abstraction.
- **Layout**
  - `infrastructure/postgres/pool.ts` — shared `Pool`, `query()` helper, `closePool()`.
  - `modules/alerts/types.ts` — `Alert` / `AlertInput` (camelCase domain types).
  - `modules/alerts/repository.ts` — SQL only; every function accepts an optional
    `Queryable` (`Pool | PoolClient`) so transactions can be used later.
  - `modules/alerts/validation.ts` — pure validation, no DB/HTTP knowledge.
  - `modules/alerts/index.ts` — public surface of the module.
- **Row mapping**: SQL columns are snake_case, NUMERIC and timestamptz; the
  repository maps to camelCase, `number` price and ISO-8601 strings.
- **Migrations**: plain numbered `.sql` files in `server/migrations/`, applied by
  `server/src/infrastructure/postgres/migrations.ts` which records applied files
  in a `schema_migrations` table, each inside a transaction (idempotent).
  Run with `npm run db:migrate --workspace server`; not executed at server startup,
  so the API process does not depend on the database being reachable.
- **Validation**: `validateAlertInput` requires non-empty `product_name` and
  `city` and a finite, non-negative `max_price`; DB `CHECK` constraints enforce
  the same rules as a last line of defense. `validateAlertId` handles route params.
- **Verification**: `npm run db:check --workspace server` exercises the full CRUD
  cycle against the real database and cleans up after itself.

### Stage 3 — Redis + temporary products (done)

- **Client**: official `redis` package (node-redis v4) with one lazily connected
  client shared by the module (`infrastructure/redis/client.ts`: `getRedis()`,
  memoized `connectRedis()`, `closeRedis()`). Importing the module has no
  side effects — connection happens on first use.
- **Key**: `alert:{alertId}:products`, a Redis **HASH** where the field is the
  product `id` and the value is the product JSON.
  - `saveProducts` = `DEL` + `HSET` in a MULTI, so saving replaces the previous
    collection for that alert and identical ids cannot stack up.
  - `getProducts` = `HGETALL` of one key; `getAllProducts` = `SCAN`
    `alert:*:products` + `HGETALL` (no index keys to keep consistent).
  - `clearAllProducts` = `SCAN` + `DEL` of every matching key.
- **Serialization**: explicit `serializeProduct` / `deserializeProduct` — strict
  validation on read (non-empty `id`, finite non-negative `price`, all other
  fields as strings). Malformed entries are skipped instead of crashing the
  cycle.
- **Deduplication** (`modules/products/dedupe.ts`, pure function): each product
  registers an `id:{id}` key and a `url:{normalizedUrl}` key (query/hash
  stripped, lowercased, trailing slash removed). A product is a duplicate if any
  of its keys was already seen; the first occurrence wins. `saveProducts` and
  `getAllProducts` both apply it, so the storage count always matches what can
  be read back.
- **Isolation**: `modules/products` knows nothing about Express or Playwright;
  the scraper (stage 7) will only consume these functions.
- **Verification**: `npm run redis:check --workspace server` runs the full
  save/get/get-all/dedupe/clear cycle against the real Redis container.

### Stage 4 — Alerts API (done)

- **Three thin layers inside `modules/alerts`** (no separate framework):
  - `routes.ts` — Express `Router`; validates nothing itself, only maps
    `ServiceResult` → HTTP status/JSON and forwards thrown errors to the
    error middleware via an async `wrap()` helper.
  - `service.ts` — validates input/ids and calls the repository; returns
    `{ ok: true, value } | { ok: false, status: 400|404, errors? }`. All status
    decisions live here, so routes stay declarative.
  - `repository.ts` — unchanged, SQL only.
- **Request body**: camelCase per the spec example (`productName`, `city`,
  `maxPrice`); `validateAlertInput` also accepts the snake_case variants for
  convenience. Error messages use camelCase.
- **Response contract** (consistent across endpoints):
  - success: `{ "data": <Alert | Alert[] | {id, deleted} | ...> }` with `200`/`201`
  - validation: `400 { "error": "validation failed", "details": ["..."] }`
  - not found: `404 { "error": "alert not found" }`
  - unknown `/api/*` route: `404 { "error": "not found" }`
  - unexpected error: `500 { "error": "internal server error" }` — the real error
    is logged server-side (`console.error`) and never sent to the client.
  - malformed JSON body: `400 { "error": "invalid JSON body" }`
- **Error flow**: async handlers reject → `wrap()` → Express error middleware in
  `app.ts`, so a database failure on any endpoint returns the same generic 500.
- **Validation order**: path id first (`400`), then body (`400`), then existence
  (`404`).

### Stage 5 — React frontend + alert management (done)

- **No state library / no router**: one screen, local `useState` in `App.tsx`,
  `useCallback` for the loader. A router or store would be unnecessary.
- **Layers**
  - `api/alerts.ts` — typed `fetch` client; unwraps `{ data }`, throws `ApiError`
    (status + server `error`/`details`) on failure, including network failures
    (`status 0`, "Could not reach the server"). Zero dependencies.
  - `components/AlertList.tsx` and `components/AlertForm.tsx` — presentational;
    they receive data and callbacks and know nothing about `fetch`.
  - `App.tsx` — owns state (`alerts`, `loading`, `listError`, `form`,
    `saving`, `deletingId`) and calls the API client.
- **Immediate feedback**: create/update/delete update local state with the
  server response instead of refetching, so the list changes instantly.
- **Error handling**: load/delete failures show a banner with **Retry** (reloads
  the list); save failures keep the form open and show the message (server
  `details` are joined). Client-side validation mirrors the server rules for a
  faster loop; the server remains the source of truth.
- **Delete confirmation**: `window.confirm` before `DELETE`.
- **Vite proxy**: `/api` → `http://localhost:3000` (configured in
  `vite.config.ts`), so the frontend uses relative URLs and no CORS setup is
  needed.
- **Styling**: one plain CSS file (no UI framework), BRL formatting via
  `Intl.NumberFormat("pt-BR")`, responsive through a single media query
  (form columns collapse below 720px, cards wrap).


### Stage 6 — Playwright + persistent Facebook session (done)

- **Dependency**: `playwright` (library only — no `@playwright/test`, no test
  runner). Browsers are installed once with `npx playwright install chromium`.
- **Module**: `server/src/infrastructure/browser/` exposes a process-wide
  singleton: `getBrowserContext()` creates the `chromium.launchPersistentContext`
  on first use and returns the **same context** on every later call, so the
  browser is never recreated per alert or per scheduler execution.
- **Persistent profile**: `BROWSER_USER_DATA_DIR` (default `<repo>/.browser-profile`,
  gitignored) stores cookies/localStorage, so the Facebook session survives
  restarts when Facebook keeps it alive.
- **Lifecycle**: the server initializes the session eagerly after `listen`
  (`initBrowserSession()`), opens Marketplace and reports whether login is
  required. Startup never blocks or crashes the API if the browser fails.
- **Login detection**: after navigating, the session is considered
  unauthenticated when the URL contains `/login` or a visible
  `input[name="pass"]` exists (Facebook shows a login dialog over Marketplace
  for logged-out visitors).
- **Manual login flow**: `npm run browser:login` opens a headed window (forced,
  ignoring `BROWSER_HEADLESS`), tells the user to log in, and polls the DOM
  (no navigation, so typing is not interrupted) until the form disappears; the
  session is persisted automatically by the profile directory. Credentials are
  never read, automated or stored — nothing Facebook-related goes to `.env`.
- **Signal handling**: `server.ts` closes the browser on SIGINT/SIGTERM with a
  bounded wait (3 s) plus a 5 s force-exit. Playwright installs its own SIGINT
  handler that force-exits with code 130 after killing browsers; when the host
  app already listens for SIGINT, `launch()` removes only that listener so the
  server's graceful path owns shutdown. Standalone scripts keep Playwright's
  default behavior.
- **Profile lock**: a second process opening the same profile fails fast with
  an actionable "profile is already in use" error instead of corrupting state.
- **Headless switch**: `BROWSER_HEADLESS` (default `false`, headed, so a human
  can log in); scripts and CI can run headless.

### Stage 7 — Facebook Marketplace scraper (done)

- **Module**: `server/src/modules/scraper/` — isolated from Express, Redis and
  the scheduler. The whole surface used by later stages is one function:
  `scrapeAlert(alert): Promise<Product[]>` (re-exported from the module barrel
  together with `ScrapeError` and the pure helpers).
- **Flow**: search page → card DOM parsing → city/price prefilter → detail page
  per survivor → final price/city check → `dedupeProducts`.
  - **Search URL carries only the query** (`/marketplace/search/?query=...`);
    Facebook ignores a city in the URL (a city path like `/marketplace/bauru/`
    redirects to the category page asking for a location). The result set is
    whatever the profile's Marketplace location (currently San Francisco area)
    shows, and city filtering happens client-side on the card/detail location
    string.
  - **Cards** (`parseCard`): one `a[href*="/marketplace/item/"]` per listing;
    the id and canonical URL come from the href; the `span[dir="auto"]` list is
    `[badge?, price, oldPrice?, title, location]` — the last two spans are
    always title/location, the current price is the first parseable span before
    them (so badges like "Acabou de ser anunciado" and old prices are skipped).
  - **Prefilter**: cards whose location string does not match the alert city
    (after `normalizeCity`: case/accents/`- SP` suffixes ignored) or whose
    quick-parsed price already exceeds `maxPrice` are dropped **before** any
    detail navigation, keeping a run to a handful of page loads.
  - **Detail payload**: the visible detail DOM does not render for logged-out
    sessions (the internal GraphQL endpoint returns 500), so we read the
    server-rendered `script[type="application/json"]` that contains
    `marketplace_product_details_page` (its `.target` holds title, price,
    location, description, `creation_time` and seller). Multiple scripts can
    mention the marker — a small `ScheduledServerJS` stub plus the real
    payload — so `loadDetail` tries each until one parses. Title, description
    and `createdAt` come from the detail; price prefers the card text, falls
    back to the detail price, then to title/description text (`extractPrice`).
  - **Result**: `Product[]` deduplicated by id/canonical URL. `ScrapeError`
    (with `alertId`) is thrown only for untrustworthy runs — login wall,
    unusable page, or every detail load failing; legitimate empty results
    return `[]`.
- **Logged-out limitations** (honest behavior, not workarounds): `seller` is
  always `""`, prices stay in the profile's currency (no conversion), and the
  empty-results detection relies on the page text "Nenhum classificado
  encontrado" (pt-BR locale observed on this profile).
- **Page lifecycle**: one `context.newPage()` per `scrapeAlert` call, closed in
  `finally`; the persistent context itself is the shared singleton from stage 6.
- **Verification**: `npm run scrape:check` — pure parsing assertions (price and
  city normalization, real captured card samples, the observed detail payload)
  plus a live run: Oakland `bicicleta` ≤ 100 returns products that pass the
  model round-trip, a Bauru-filtered run returns 0, and an impossible query
  returns 0 through the empty state without throwing.

### Stage 8 — Scheduler + complete scraping cycle (current)

- **Dependency**: `node-cron@^3` (+ `@types/node-cron`). v4 requires Node ≥ 20;
  this project runs on Node 18, and v3 is CommonJS which matches the server's
  module system.
- **Cycle** (`modules/scheduler/cycle.ts`, `runCycle()`): lock → clear Redis
  products → load alerts from Postgres → scrape all alerts sequentially in a
  single shared browser tab → isolate failures → filter (city + max price, per
  alert) → dedupe → save each
  alert's products to Redis → structured summary. Legitimate empty results are
  saved as an empty collection (the previous cycle's products are replaced),
  so Redis always reflects the last cycle only.
- **Execution lock**: an in-memory boolean (single backend process by design).
  A trigger arriving while a cycle runs logs the skip and returns
  `{ status: "skipped" }`; the manual endpoint maps that to `409`, the cron
  trigger just logs it. Overlapping cycles can never interleave in Redis.
- **Failure isolation**: alerts are scraped sequentially with per-alert
  try/catch, producing the same settled results as `Promise.allSettled`, so
  one alert's `ScrapeError` (or any rejection) is recorded in the cycle
  summary and logged while every other alert still runs and saves.
  `scrapeAll()` is the single point that serializes alerts, because they all
  share one browser tab (`getScrapePage()` reuses the session tab).
- **Manual trigger**: `POST /api/scheduler/run` runs the *same* `runCycle()`
  the cron runs (trigger=manual) and responds with the cycle summary — it
  never replaces the cron. `runCycle({ scrape })` accepts an injectable
  scraper, which validation uses to prove failure isolation and filtering
  deterministically without depending on live Facebook behavior.
- **Schedule**: `CRON_SCHEDULE` env, default `*/15 * * * *`. Invalid
  expressions are reported at startup instead of crashing the server. The
  server starts the cron after `listen` and stops it first on SIGINT/SIGTERM,
  before closing the browser.
- **Logging**: `[scheduler]`-prefixed lines — cycle start, preparation
  (alerts + cleared keys), per-alert outcome, failures with the error name,
  and a completion line carrying a JSON summary (`trigger`, counts,
  `durationMs`); skips log the trigger that was refused.
- **Not implemented (per scope)**: product history, Postgres product storage,
  queues, multiple workers, Web Push.

## Planned module boundaries

| Module           | Responsibility                                             | Depends on       |
| ---------------- | ---------------------------------------------------------- | ---------------- |
| `alerts`         | CRUD + REST API under `/api/alerts` (**implemented, stage 4**) | postgres     |
| `products`       | Temporary products for the current cycle (**stage 3**)     | redis            |
| `scraper`        | Playwright search + filtering (city, price, dedupe) (**stage 7**) | playwright, products |
| `scheduler`      | Cron cycle, execution lock, orchestration (**stage 8**) | all modules      |
| `notifications`  | Single Web Push per cycle                                  | web-push         |

Business logic stays out of Express route handlers; scraping is isolated from HTTP;
Redis and PostgreSQL access are isolated from their callers.
