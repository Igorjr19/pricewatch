## 10. API

Base: `/api/v1`. JSON. Authentication: `Authorization: Bearer <PW_API_TOKEN>` on all routes except `GET /health`.

- **REQ-API-001 (MUST)** A request without a token or with an invalid token → `401`. Token comparison is constant-time.
- **REQ-API-002 (MUST)** Errors follow `{ "error": { "code": string, "message": string, "details"?: any } }`.
- **REQ-API-003 (MUST)** DTO validation failure → `400` with the invalid fields in `details`.
- **REQ-API-004 (MUST)** Listings accept `limit` (default 50, max 500) and `cursor` (ULID), and return `{ items, nextCursor }`.
- **REQ-API-005 (MUST)** Monetary values in the API are always integer cents, with the `Cents` suffix in the field name.

### 10.1 Routes

| Method | Route | Description |
|---|---|---|
| GET | `/health` | `{ status, version, db: "ok"\|"error" }`; 503 if the database fails. No auth. |
| GET | `/adapters` | Supported stores: id, name, domains, strategies, whether the browser is available |
| POST | `/probe` | `{ url }` → normalizes, resolves adapter, extracts and returns the `ExtractResult` **without persisting** |
| GET | `/products` | Lists products with `bestEffectivePriceCents`, `bestListingId`, `lowestEverCents` (only observations with `in_stock = 1`, as in `new_low`) |
| POST | `/products` | `{ name, notes? }` |
| GET | `/products/:id` | Product + listings (with last observation and status) + rules |
| PATCH | `/products/:id` | `{ name?, notes?, archived? }` |
| DELETE | `/products/:id` | Removes product, listings, observations and rules. `?confirm=true` required |
| POST | `/products/:id/listings` | `{ url, checkIntervalMinutes? }` → 201; 409 if the normalized URL already exists; 422 without an adapter |
| PATCH | `/listings/:id` | `{ status?: "active"\|"paused", checkIntervalMinutes? }`. Changing to `active` resets `consecutive_failures` and sets `next_check_at = now` |
| DELETE | `/listings/:id` | Removes the listing and its observations |
| POST | `/listings/:id/check` | Forces `next_check_at = now` (collection happens in the next cycle) |
| GET | `/listings/:id/observations` | `?from&to&limit&cursor` |
| GET | `/listings/:id/attempts` | Latest fetch attempts |
| GET | `/products/:id/history` | `?bucket=day&from&to` → per listing and per day: min, max and last effective price |
| GET | `/products/:id/rules` | |
| POST | `/products/:id/rules` | `{ type, params, channels?, cooldownMinutes?, enabled? }` |
| PATCH | `/rules/:id` | Changes any field except `type`. Changing `params` re-arms the rule |
| DELETE | `/rules/:id` | |
| GET | `/channels` | Configured channels: name, type, masked destination |
| POST | `/channels/:name/test` | Sends `system.test` through the channel; responds with success or error |
| GET | `/notifications` | Delivery history |
| POST | `/run` | Executes a cycle (REQ-RUN-004). Accepts `PW_RUN_TOKEN` |
| GET | `/runs` | Cycle history |

- **REQ-API-010 (MUST)** `POST /products/:id/listings` normalizes the URL before checking for duplicates.
- **REQ-API-011 (SHOULD)** `POST /products/:id/listings` accepts `?probe=true` to run an immediate extraction and return the result, persisting the first observation.
- **REQ-API-012 (MUST)** `GET /health` responds in under 200 ms with a local database.

> **Cold-start usage:** when deployed only as a scheduled `run`, no API is exposed. To register products, run `pricewatch serve --no-cron` locally (or on a scale-to-zero service) pointing at the same `PW_DATABASE_URL`.
