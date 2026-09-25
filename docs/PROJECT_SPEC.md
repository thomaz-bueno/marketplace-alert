# Marketplace Alert — Project Specification

Local personal application that monitors Facebook Marketplace for products matching
user-created alerts.

## Concept

The user creates an alert containing exactly:

- `product_name`
- `city`
- `max_price`

Example: product `iPhone 13`, city `Bauru`, maximum price `R$ 2.000`.

Every 15 minutes the backend:

1. Clears temporary products stored in Redis.
2. Loads all alerts from PostgreSQL.
3. Searches Facebook Marketplace for each alert.
4. Extracts matching listings.
5. Filters by city.
6. Extracts and normalizes prices.
7. Filters by maximum price.
8. Deduplicates results within the current execution.
9. Stores matching products in Redis.
10. Makes those products available to the frontend.
11. Sends one Web Push notification if products were found.

The application is local, single-user, and has no authentication.

## Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Frontend   | React, Vite, TypeScript                        |
| Backend    | Node.js, TypeScript, Express, node-cron, Playwright |
| Data       | PostgreSQL (alerts), Redis (temporary products) |
| Infra      | Docker Compose with PostgreSQL and Redis only  |

The Node.js backend and React frontend run locally during development.

## Data model

### PostgreSQL — `alerts`

| Column         | Type |
| -------------- | ---- |
| id             | serial/bigint PK |
| product_name   | text |
| city           | text |
| max_price      | numeric |
| created_at     | timestamp |
| updated_at     | timestamp |

There is intentionally **no** PostgreSQL products table. Products are temporary.

### Redis — temporary products

Key: `alert:{alertId}:products`

Products exist only for the current scraping cycle and are cleared at the beginning
of each cycle. No historical product storage.

### Product

```ts
interface Product {
  id: string; // Facebook listing id, fallback: normalized URL
  title: string;
  price: number;
  location: string;
  image: string;
  url: string;
  seller: string;
  description: string;
  createdAt: string;
}
```

## Scraping rules

- Search uses the alert `product_name`; variations returned by Facebook are accepted.
- No semantic search in the MVP.
- City matching is normalized (case, whitespace, punctuation, formatting):
  `Bauru`, `Bauru - SP`, `Bauru, São Paulo`, `Bauru/SP`, `BAURU - SP` are the same city.
  No geographic radius calculations.
- Price is taken from the Marketplace price field, title, or description and
  normalized (`R$ 1.800`, `R$1.800`, `1.800`, `R$ 1.800,00`). Listings without a
  reliable price are excluded. No AI-based price inference.
- Deduplication within a single execution by `product.id` (or normalized URL).
  No cross-cycle deduplication (Redis is reset each cycle).

## Concurrency

All alerts are processed concurrently (`Promise.all`), structured so controlled
concurrency can be introduced later. No queue system.

## Scheduler

- `node-cron`, schedule `*/15 * * * *`.
- In-memory execution lock: if a run is still going, the next trigger is skipped.
- One failed alert must not abort the other alerts.
- Cycle: lock → clear Redis → load alerts → scrape all → filter → dedupe → save →
  notify (if products) → release lock.

## API

```
GET    /api/alerts
POST   /api/alerts
GET    /api/alerts/:id
PUT    /api/alerts/:id
DELETE /api/alerts/:id

GET /api/products
GET /api/alerts/:id/products

GET /health
```

## Frontend

Single-page personal dashboard:

- Alert management: create, list, edit, delete.
- Products: one global list of the latest cycle results with image, title, price,
  location, and a link to open the listing.

## Web Push

- Only when the current cycle finds products.
- 0 products → no notification.
- 1+ products → exactly one notification per cycle
  (e.g. `3 new Marketplace products found`).

## Out of scope (MVP)

Authentication, multiple users, admin panel, product history, PostgreSQL products
table, favorites, WhatsApp/Telegram/email, analytics, recommendations, AI
classification, geographic radius search, Kafka/RabbitMQ, Kubernetes,
microservices, cloud infrastructure, payments, complex ranking, automated Facebook
credentials or account creation.

## Implementation stages

1. Project foundation
2. PostgreSQL + Alerts
3. Redis + Products
4. Alerts API
5. React frontend + Alerts
6. Playwright + persistent Facebook session
7. Marketplace scraper
8. Scheduler + complete scraping cycle
9. Products UI
10. Web Push + final hardening
