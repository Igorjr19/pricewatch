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
| A1 | Mercado Livre: confirm whether the public items API requires an application token and which fields give the Pix price. Decide whether `http` alone is enough. | open (2026-10-20, partial): the items API returns 403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` without a token. `http` from a residential WSL IP gets HTTP 200 redirecting to `/gz/account-verification` (`negative_traffic`), so blocked detection must key on the final URL or body markers, not the status. Fixture: `test/fixtures/mercadolivre/blocked-account-verification.html`. Out-of-stock page (browser capture, user-product `/up/MLBU…`): JSON-LD `Product.offers` has `price: 0` + `availability: …/OutOfStock`; state `_n.ctx.r` (brace-aware parse) has `has_stock=false`, `pdp_type=NO_STOCK`, `no_stock_status` VISIBLE; `price`/`seller` components hidden. `price<=0` with OutOfStock means no price. Strategy: JSON-LD first, `_n.ctx.r` for Pix/installments/seller. Fixture: `test/fixtures/mercadolivre/out-of-stock.html`. In-stock page (`/p/MLB2000122846`, item `MLB7813355752`; fixture `test/fixtures/mercadolivre/in-stock.html`): **JSON-LD price is not usable** (a `ProductGroup` whose variant `offers.price` 1444.33 matches neither cash nor Pix). Decision: read the state `script#__NORDIC_RENDERING_CTX__` (`_n.ctx.r=…`, parse with brace-aware decoding), under `appProps.pageProps.initialState.components`: `priceCents` = `price.subtitles[0].values.total_price.value` (1399), `pixPriceCents` = `price.price_breakdown.bottomsheet.footer.value.label.values.price.value` (1287.08) only when `price_breakdown` has a "Desconto no Pix" item (`price.price.value` already equals the Pix price); installments `subtitles[0].values.price_installments`; stock = `no_stock_status.state` HIDDEN and `available_quantity`; seller = `seller_data` header title; `externalId` = item id (`bookmark.item_id`), catalog id secondary. `/p/MLB…` identifies only the catalog entry; the offer is `?pdp_filters=item_id:MLB…` (keep it in `normalizeUrl`). Fixtures now cover blocked, out of stock and in stock (captured with a real browser). Still open: whether `http` ever returns this markup instead of the challenge (if not, `api` token or M2 `browser`), whether the Pix discount is conditional, `/up/MLBU` normalization. |
| A2 | Samsung Shop: identify the store platform, whether the price is in the HTML or only via JS, and where the Pix price appears. Define strategies. | open |
| A3 | Motorola Shop: same investigation as A2. | open |
| A4 | Amazon: measure the captcha rate via `http` from a datacenter IP and from a residential IP. Decide whether `browser` becomes the primary strategy. | open |
| A5 | Magalu: confirm the most stable data source (JSON-LD or embedded state JSON). | open |
| A6 | Kabum: confirm where the Pix price appears. | closed 2026-10-20: `http` is enough. Primary strategy `__NEXT_DATA__` (`props.pageProps.product`): `prices.price` = `priceCents`, `prices.priceWithDiscount` = Pix, set `pixPriceCents` only when below `price`. Stock = `available && flags.isAvailable` (out-of-stock pages keep stale prices). Fallback JSON-LD, but `offers.price` is the Pix value, not the list price. 404 with no `product` → `NotFoundError`; `/produto/<id>` 301-redirects to a slug path. Fixtures: `test/fixtures/kabum/` (`in-stock-*.html`, `out-of-stock.html`, `not-found.html`, `manifest.json`). Still missing: blocked/captcha fixture (synthetic, labelled) and a product with no Pix discount. |

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
