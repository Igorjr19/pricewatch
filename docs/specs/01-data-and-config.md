## 5. Data model

All tables have `id TEXT PRIMARY KEY` (ULID) unless stated otherwise. Timestamps are `TEXT` in ISO 8601 UTC.

### 5.1 `products`

| Column | Type | Rules |
|---|---|---|
| `name` | text | required, 1–200 characters |
| `notes` | text | optional |
| `archived_at` | text | null = active |
| `created_at`, `updated_at` | text | |

### 5.2 `listings`

| Column | Type | Rules |
|---|---|---|
| `product_id` | text FK → products | required |
| `adapter_id` | text | adapter id resolved from the domain |
| `url` | text | URL **normalized** by the adapter; globally unique |
| `external_id` | text | e.g. ASIN, MLB, SKU, when the adapter can extract it |
| `status` | text | `active` \| `paused` \| `failing` |
| `check_interval_minutes` | integer | null = use `PW_SCRAPE_INTERVAL` |
| `next_check_at` | text | required; on creation = now |
| `last_checked_at`, `last_success_at` | text | |
| `consecutive_failures` | integer | default 0 |
| `created_at`, `updated_at` | text | |

Index: `(status, next_check_at)`.

### 5.3 `observations`

| Column | Type | Rules |
|---|---|---|
| `listing_id` | text FK | |
| `observed_at` | text | |
| `price_cents` | integer | displayed cash price; null if the store shows none |
| `pix_price_cents` | integer | null if there is no distinct Pix price |
| `effective_price_cents` | integer | computed on write (see glossary); null if both are null |
| `installment_count` | integer | null if none |
| `installment_price_cents` | integer | amount of each installment |
| `in_stock` | integer (0/1) | |
| `seller` | text | optional |
| `title` | text | title read from the page |
| `strategy` | text | `api` \| `http` \| `browser` |

Index: `(listing_id, observed_at DESC)`.

### 5.4 `fetch_attempts`

| Column | Type | Rules |
|---|---|---|
| `listing_id` | text FK | |
| `run_id` | text FK → runs | |
| `started_at` | text | |
| `duration_ms` | integer | |
| `strategy` | text | |
| `outcome` | text | `ok` \| `blocked` \| `not_found` \| `parse_error` \| `http_error` \| `timeout` \| `strategy_unavailable` |
| `http_status` | integer | when available |
| `error_message` | text | truncated to 1000 characters |

### 5.5 `rules`

| Column | Type | Rules |
|---|---|---|
| `product_id` | text FK | |
| `type` | text | `target_price` \| `new_low` \| `back_in_stock` |
| `params` | text (JSON) | validated per type (section 8) |
| `channels` | text (JSON array) | channel names; empty = `PW_DEFAULT_CHANNELS` |
| `enabled` | integer (0/1) | default 1 |
| `cooldown_minutes` | integer | null = `PW_ALERT_COOLDOWN` |
| `state` | text (JSON) | internal evaluator state (see 8.2), per listing when the rule is per-listing; holds `lastNotifiedPriceCents` and `pendingDelivery` |
| `last_triggered_at` | text | |
| `created_at`, `updated_at` | text | |

### 5.6 `notifications`

| Column | Type | Rules |
|---|---|---|
| `rule_id` | text FK, nullable | null for system notifications; `ON DELETE SET NULL` |
| `listing_id` | text FK, nullable | `ON DELETE SET NULL` |
| `observation_id` | text FK, nullable | `ON DELETE SET NULL` |
| `channel` | text | channel name |
| `kind` | text | `alert` \| `system` \| `test` |
| `status` | text | `sent` \| `failed` |
| `payload` | text (JSON) | the event that was sent |
| `error_message` | text | |
| `created_at` | text | |

### 5.7 `runs`

| Column | Type | Rules |
|---|---|---|
| `trigger` | text | `ticker` \| `cli` \| `api` |
| `started_at`, `finished_at` | text | |
| `status` | text | `running` \| `completed` \| `timed_out` \| `failed` |
| `listings_due`, `listings_checked`, `successes`, `failures` | integer | |
| `notifications_sent` | integer | |

### 5.8 `run_lock`

Single row (`id = 1`): `holder TEXT`, `acquired_at TEXT`, `expires_at TEXT`.

### Requirements

- **REQ-DB-001 (MUST)** The database is accessed exclusively through Drizzle over `@libsql/client`, with the URL set in `PW_DATABASE_URL`.
- **REQ-DB-002 (MUST)** Support `file:<path>` (local), `file::memory:` (tests) and `libsql://...` with `PW_DATABASE_TOKEN` (remote).
- **REQ-DB-003 (MUST)** On a local database, enable `PRAGMA journal_mode = WAL` and `foreign_keys = ON` on the connection.
- **REQ-DB-004 (MUST)** The `migrate` command applies pending migrations and is idempotent.
- **REQ-DB-005 (MUST)** With `PW_AUTO_MIGRATE=true` (default), `serve` and `run` apply migrations before any other operation.
- **REQ-DB-006 (MUST)** At the end of each cycle, `fetch_attempts` and `notifications` older than `PW_RETENTION_DAYS` are deleted. `observations` are never pruned (history backs `new_low`).

> **Acceptance REQ-DB-004**
> Given an empty database, when `pricewatch migrate` runs twice in a row, then the second run exits with code 0 and does not change the schema.

## 6. Configuration

- **REQ-CFG-001 (MUST)** All configuration comes from environment variables, validated by zod at boot.
- **REQ-CFG-002 (MUST)** Invalid env terminates the process with exit code 1 and a message listing **each** invalid variable and the reason.
- **REQ-CFG-003 (MUST)** Durations accept the format `30s`, `15m`, `3h`, `1d`.
- **REQ-CFG-004 (MUST)** No secret (tokens, passwords, full channel URLs) appears in logs or API responses. In responses, mask as `tele***`.

### 6.1 Variables

| Variable | Default | Description |
|---|---|---|
| `PW_PORT` | `8080` | HTTP port |
| `PW_API_TOKEN` | — | **Required for `serve`.** API bearer token |
| `PW_RUN_TOKEN` | = `PW_API_TOKEN` | Token accepted on `POST /api/v1/run` |
| `PW_TZ` | `America/Sao_Paulo` | Timezone used to format messages |
| `PW_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PW_DATABASE_URL` | `file:/data/pricewatch.db` | |
| `PW_DATABASE_TOKEN` | — | Required when the URL is `libsql://` |
| `PW_AUTO_MIGRATE` | `true` | |
| `PW_TICK` | `5m` | Internal ticker interval in `serve` |
| `PW_SCRAPE_INTERVAL` | `3h` | Default per-listing interval |
| `PW_SCRAPE_JITTER` | `20m` | Random ± variation applied to the next check time |
| `PW_CONCURRENCY` | `2` | Listings processed in parallel |
| `PW_DOMAIN_DELAY` | `8s` | Minimum interval between requests to the same domain |
| `PW_RUN_MAX_LISTINGS` | `50` | Maximum listings per cycle |
| `PW_RUN_TIMEOUT` | `10m` | Maximum duration of a cycle |
| `PW_MAX_BACKOFF` | `24h` | Backoff ceiling after failures |
| `PW_FETCH_FIXTURES_DIR` | — | Dev only (REQ-DX-009): `HttpFetcher` answers from this directory's `manifest.json` files, no network |
| `PW_RETENTION_DAYS` | `90` | Retention of `fetch_attempts` and `notifications` (REQ-DB-006) |
| `PW_FAILING_THRESHOLD` | `5` | Consecutive failures before a listing is marked `failing` |
| `PW_HTTP_TIMEOUT` | `20s` | |
| `PW_USER_AGENT` | recent stable Chrome UA | |
| `PW_BROWSER` | `off` | `off` \| `local` \| `ws://host:port` (M1 accepts only `off`) |
| `PW_BROWSER_TIMEOUT` | `45s` | From M2 onward |
| `PW_ALERT_COOLDOWN` | `12h` | Default rule cooldown |
| `PW_DEFAULT_CHANNELS` | all configured | Comma-separated list |
| `PW_SYSTEM_CHANNELS` | = `PW_DEFAULT_CHANNELS` | Channels for system notices |
| `PW_CHANNEL_<NAME>` | — | Defines a channel (see 9.1) |
| `PW_MELI_CLIENT_ID`, `PW_MELI_CLIENT_SECRET` | — | Optional; enable the Mercado Livre `api` strategy |
