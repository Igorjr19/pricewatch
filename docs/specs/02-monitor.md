## 7. Monitor

### 7.1 Execution modes

- **REQ-RUN-001 (MUST)** `pricewatch serve` starts the API and a ticker that triggers a cycle every `PW_TICK`.
- **REQ-RUN-002 (MUST)** `pricewatch serve --no-cron` starts only the API.
- **REQ-RUN-003 (MUST)** `pricewatch run` executes **one** cycle and exits: code 0 if the cycle completed (even with listing failures), 2 if the lock was busy, 1 on fatal error.
- **REQ-RUN-004 (MUST)** `POST /api/v1/run` executes a cycle **synchronously** and responds with the run summary. Responds `409` if the lock is busy. (Synchronous because scale-to-zero platforms may freeze the container after the response.) Known limitation: the request may last up to `PW_RUN_TIMEOUT`; where proxies cut earlier, use a scheduled `pricewatch run`.
- **REQ-RUN-005 (MUST)** The ticker never starts a cycle while another is in progress in the same process.
- **REQ-RUN-006 (MUST)** `SIGTERM` stops the cycle cleanly: stops starting new listings, waits up to 15 s for those in flight, records the run as `failed` with a reason and releases the lock. Plain `docker run` sends SIGKILL after 10 s, so the example compose file sets `stop_grace_period: 20s`.

### 7.2 Cycle

- **REQ-CYC-001 (MUST)** A cycle acquires `run_lock` atomically, with `expires_at = now + PW_RUN_TIMEOUT + 1m`. An expired lock may be taken over.
- **REQ-CYC-002 (MUST)** The cycle selects listings with `status IN ('active','failing')` and `next_check_at <= now`, from non-archived products, ordered by `next_check_at`, limited to `PW_RUN_MAX_LISTINGS`.
- **REQ-CYC-003 (MUST)** Processing respects `PW_CONCURRENCY` globally and `PW_DOMAIN_DELAY` between requests to the same domain.
- **REQ-CYC-004 (MUST)** On reaching `PW_RUN_TIMEOUT`, the cycle stops starting listings, finishes evaluation and notifications for what was already collected, and records the run as `timed_out`.
- **REQ-CYC-005 (MUST)** Order within a cycle: collection → rule evaluation for affected products → notification delivery → summary write → lock release.
- **REQ-CYC-006 (MUST)** Every read attempt produces a row in `fetch_attempts`.

> **Acceptance REQ-CYC-001**
> Given a valid lock held by another holder, when `pricewatch run` is executed, then it exits with code 2 without writing any observation.
> Given a lock whose `expires_at` is in the past, when `run` is executed, then it takes the lock and completes the cycle.

### 7.3 Per-listing scheduling

- **REQ-SCH-001 (MUST)** After success: `next_check_at = now + interval ± jitter`, where jitter is drawn uniformly from `[-PW_SCRAPE_JITTER, +PW_SCRAPE_JITTER]` and the result is never earlier than `now + 1m`.
- **REQ-SCH-002 (MUST)** After failure: `consecutive_failures += 1` and `next_check_at = now + min(interval × 2^(failures-1), PW_MAX_BACKOFF)`.
- **REQ-SCH-003 (MUST)** When `consecutive_failures` reaches `PW_FAILING_THRESHOLD`, the status changes to `failing` and a system notification is sent **once** to `PW_SYSTEM_CHANNELS`.
- **REQ-SCH-004 (MUST)** A success resets `consecutive_failures`, returns the status to `active` and, if it was `failing`, sends a recovery system notification.
- **REQ-SCH-005 (MUST)** `paused` listings are never selected.

> **Acceptance REQ-SCH-002**
> Given a 3h interval and a listing with 2 failures, when the 3rd failure occurs, then `next_check_at = now + 12h`.
> Given `PW_MAX_BACKOFF=24h` and 6 failures, then `next_check_at = now + 24h`.

### 7.4 Fetch

- **REQ-FET-001 (MUST)** `HttpFetcher` sends `User-Agent` from `PW_USER_AGENT`, `Accept-Language: pt-BR,pt;q=0.9`, accepts gzip/br, follows redirects and honors `PW_HTTP_TIMEOUT`. Redirects are followed only within the same adapter's domains; any other destination results in `http_error`.
- **REQ-FET-002 (MUST)** `BrowserFetcher` uses a single browser per cycle, a fresh context per listing, blocks images, fonts and media, and honors `PW_BROWSER_TIMEOUT`.
- **REQ-FET-003 (MUST)** With `PW_BROWSER=off`, a `browser` strategy results in `strategy_unavailable` without trying to open a browser. This does **not** count as a failure for backoff: no observation is written and the listing is rescheduled at the normal interval.
- **REQ-FET-004 (MUST)** The browser is started only if some listing in the cycle needs it, and is closed at the end of the cycle.
- **REQ-FET-005 (MUST)** 403/429 responses, captcha pages or anti-bot challenges detected by the adapter result in `blocked`.
- **REQ-FET-006 (SHOULD)** On `blocked` via `http`, the adapter tries the next strategy in its list, if any.

> **Milestone M1:** FET-002, FET-004 and FET-006 apply from M2 onward (browser deferred). FET-003 applies from M1.

### 7.5 Adapters

```ts
type Strategy = 'api' | 'http' | 'browser';

interface ExtractResult {
  priceCents: number | null;
  pixPriceCents: number | null;
  installments: { count: number; priceCents: number } | null;
  inStock: boolean;
  title: string | null;
  seller: string | null;
  externalId: string | null;
}

interface StoreAdapter {
  readonly id: string;              // 'kabum'
  readonly displayName: string;     // 'KaBuM!'
  readonly domains: string[];       // ['kabum.com.br', 'www.kabum.com.br']
  readonly strategies: Strategy[];  // order of attempt
  normalizeUrl(url: URL): URL;      // strips tracking, canonicalizes
  extract(ctx: ExtractContext): Promise<ExtractResult>;
}
// ExtractContext provides: current strategy, html (http/browser) or client (api), url
// Typed errors: BlockedError, NotFoundError, ParseError
```

- **REQ-ADP-001 (MUST)** The registry resolves the adapter from the URL hostname. URL without an adapter → `422` in the API, with the list of supported domains.
- **REQ-ADP-002 (MUST)** `normalizeUrl` strips tracking parameters (`utm_*`, `ref`, `tag`, `gclid` and store-specific ones) and produces a stable canonical form. Two URLs for the same product with different tracking normalize to the same value.
- **REQ-ADP-003 (MUST)** Monetary values are extracted with the `parseBRL` helper, which accepts `R$ 1.234,56`, `1234,56`, `1.234` and JSON-LD numbers (`1234.56`), always returning integer cents.
- **REQ-ADP-004 (MUST)** A page from which neither price nor stock can be determined raises `ParseError`. Never write an invented observation.
- **REQ-ADP-005 (MUST)** Unavailable product with a valid page → `inStock = false`, prices may be null.
- **REQ-ADP-006 (MUST)** `pixPriceCents` is only filled when the store explicitly shows a Pix/cash price with a discount different from the main price.
- **REQ-ADP-007 (MUST)** Each adapter passes the contract suite (section 11.2) with at least three fixtures: in stock, out of stock, and blocked/captcha.
- **REQ-ADP-008 (MUST)** Shared helpers: `extractJsonLdProduct(html)`, `selectText(html, selector)`, `extractEmbeddedJson(html, scriptId | regex)`.

#### 7.5.1 Stores and milestones

- **M1 (defines the MVP):** `kabum` and `mercadolivre`, both via `http` (`api` only if A1 shows it is needed). Cycle, alerts, notifications and API complete.
- **M2:** `magalu` and `amazon`, after closing A4/A5. Brings the browser (`BrowserFetcher`, `full` image).
- **M3:** `samsung` and `motorola`, after closing A2/A3.

The MVP is done when M1 passes end to end. The table below is the final target.

| Adapter | Domains | Strategies (order) | Implementation notes |
|---|---|---|---|
| `kabum` | kabum.com.br | `http` | Start with JSON-LD. Check the page for a Pix price. |
| `magalu` | magazineluiza.com.br | `http`, `browser` | JSON-LD or embedded state JSON. High block risk from datacenter IPs. |
| `amazon` | amazon.com.br | `http`, `browser` | Canonicalize to `/dp/<ASIN>`. Detect captcha page as `blocked`. Distinguish Amazon from third-party sellers in `seller`. |
| `mercadolivre` | mercadolivre.com.br, produto.mercadolivre.com.br | `api` (if credentials), `http` | `externalId` = MLB. The `api` strategy only applies when `PW_MELI_*` are set. |
| `samsung` | samsung.com (path `/br/`) | to be defined | **Investigation needed** (see 14). Reject URLs outside `/br/`. |
| `motorola` | motorola.com.br | to be defined | **Investigation needed** (see 14). |

- **REQ-ADP-010 (MUST)** Before implementing each adapter, save at least one real page in `test/fixtures/<adapter>/` and record in section 14 which strategy and which data sources (JSON-LD, selector, embedded JSON) were chosen.
