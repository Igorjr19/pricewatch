## 13. Out of scope for the MVP

- Web dashboard
- Multi-user, signup and login
- Declarative YAML adapters (D13)
- Internationalization and multi-currency (R7)
- Native WhatsApp (use the webhook channel with an external gateway)
- Coupons, cashback and shipping in the effective price
- Postgres or other databases
- CI/CD, Terraform and cloud deployment
- Apprise and other channels
- Price prediction
- `percent_drop` rule (deferred; ALR-004 reserved)
- Resend channel (deferred; REQ-NOT-012 reserved)
- Browser, `BrowserFetcher` and `full` image (M2)
- Mandatory `arm64` build
- Management CLI (`pricewatch add`/`list`): the MVP is managed only through the REST API
- Watchlist import/export

## 14. Open items and investigation log

| # | Item | Status |
|---|---|---|
| A1 | Mercado Livre: confirm whether the public items API requires an application token and which fields give the Pix price. Decide whether `http` alone is enough. | open |
| A2 | Samsung Shop: identify the store platform, whether the price is in the HTML or only via JS, and where the Pix price appears. Define strategies. | open |
| A3 | Motorola Shop: same investigation as A2. | open |
| A4 | Amazon: measure the captcha rate via `http` from a datacenter IP and from a residential IP. Decide whether `browser` becomes the primary strategy. | open |
| A5 | Magalu: confirm the most stable data source (JSON-LD or embedded state JSON). | open |
| A6 | Kabum: confirm where the Pix price appears. | open |

When closing an item, record here the decision, the date and the fixture that proves it.

### 14.1 Decisions of the v0.2 review (2026-10-20)

| # | Decision |
|---|---|
| R1 | Stores in milestones: M1 `kabum` + `mercadolivre` (`http`) defines the MVP; M2 `magalu` + `amazon` + browser; M3 `samsung` + `motorola`. |
| R2 | Management through the REST API only in the MVP; no management CLI. |
| R3 | A delivery failure on all channels does not advance rule state; re-evaluated next cycle (ALR-015). |
| R4 | Deferred: `percent_drop`, Resend channel, `full` image/Playwright (M2), mandatory `arm64`. |
| R5 | Fixes: state and last price per listing in `rules.state`; cooldown-suppressed firing keeps `armed`; `strategy_unavailable` reschedules at the normal interval; `stop_grace_period` in compose; `PW_RETENTION_DAYS`; `ON DELETE SET NULL` on `notifications`; redirects limited to the adapter's domain; effective price is the minimum of Pix and cash; `new_low` ignores out-of-stock observations; `PW_RUN_MAX_LISTINGS` default 50. |
| R6 | Project language is English (spec, code, comments, commits). User-facing alert text stays pt-BR. |
| R7 | No i18n and no multi-currency: the tool is intentionally coupled to the Brazilian shopping ecosystem (BRL, Pix, local stores). Revisit only if a non-Brazilian use case appears. |
