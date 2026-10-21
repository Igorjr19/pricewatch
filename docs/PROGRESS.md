# Progress

Handoff between sessions. Keep it short; update at the end of every slice (REQ-DX-018).

## Current step
Step 1 (scaffold) nearly done; step 2 (config + db) done except `PW_AUTO_MIGRATE` wiring in `serve`/`run` (REQ-DB-005). Steps 3 (cycle with fakes) and 4 (evaluators + AlertsService, §8.2 test) done. Step 5 (channel parser, notifiers, NotificationService) done. Steps 1-6 done, CLI wired (`serve`, `run`, `migrate` verified on the built binary). Step 7: `kabum` and `mercadolivre` adapters done (ML blocked live from this IP). Step 8 Docker done (deps stage unverified, see C1). See docs/specs/09-dx.md §15.2.

## Done
- Spec v0.4 split by area, reviewed (decisions R1–R7 in docs/specs/08-scope-and-open-items.md).
- Agent setup: `.claude/settings.json`, `store-investigator` subagent (needs a session restart to register), RTK hook, Context7 MCP, `Concise` output style (local). `mise.toml` pins Node 24.
- Scaffold: CLI stub (`src/main.ts`, `src/cli/`), `package.json`, tsconfig, Vitest + `unplugin-swc`, Biome, lefthook, `pnpm req` / `req:check`, `.env.example`. DI smoke test passes (REQ-DX-003); `pnpm check` green.
- A6 (Kabum) closed; A1 (Mercado Livre) fixtures done, `http` viability open. Details and fixtures in §14.
- Step 2: zod config (`src/config/`), Drizzle schema + first migration (`src/db/`, `drizzle/`), `migrate` command, DB integration tests (REQ-DB-002/003/004).
- Step 3: `Clock`, adapter contract + `AdapterRegistry`, `FakeAdapter`, `SchedulerService`, `RunLockService`, `CollectorService` (strategy loop, outcomes), `CycleService` (lock, due selection, concurrency, domain delay, timeout, abort, failing/recovered notices). Ports in `src/monitor/ports.ts` (`PageFetcher`, `AlertsPort`, `SystemNotifier`). 71 tests green.
- Step 4: pure evaluators (`src/alerts/evaluators/`, state per unit: product, or listing for `back_in_stock`), `AlertsService` implementing `AlertsPort` (rule selection ALR-006, history queries, dedup/cooldown, ALR-015 pending retry), `AlertDelivery` port (`src/alerts/events.ts`), params validation (`params.ts`), BRL formatting. §8.2 scenario passes both on the evaluator and end to end through `CycleService`. `pnpm test:coverage` enforces ≥90% on evaluators and scheduler (currently 99% / 98%).
- Step 5: channel parser with boot validation (`src/notifications/channel-parser.ts`, wired into `loadConfig`, incl. REQ-NOT-002 checks on default/system channel lists), Telegram/SMTP(nodemailer)/webhook(HMAC) notifiers, 15 s timeout + retries (2 s, 6 s), `NotificationService` implementing `AlertDelivery` and `SystemNotifier` (one `notifications` row per channel, secret redaction, `sendTest` for the API), pt-BR message formatting. 179 tests green.
- Step 6: `src/api/` (`ApiModule.register(deps)`, global bearer `AuthGuard` with constant-time compare and `PW_RUN_TOKEN` accepted only on `POST /run`, error envelope filter, class-validator DTOs with `details`, `CatalogService`, `ApiController`). All §10.1 routes incl. `?probe=true`, `/probe`, history buckets, cursor pagination, 409/422 rules. 206 tests green (`test/integration/api.spec.ts`, supertest).
- CLI wiring: `src/app/runtime.ts` (composition root, `PW_AUTO_MIGRATE`), `HttpFetcher` (same-domain redirects, timeout), `Ticker` (no overlap, abortable), retention pruning at the end of each cycle, `run` exit codes 0/2/1, `serve` with SIGTERM (15 s grace). Build uses `tsconfig.build.json`. Verified by hand on `dist/`: migrate, run (0 and 2 with a held lock), serve health/auth/run, SIGTERM exit 0, bad env exit 1.
- Step 7a: shared helpers (`parseBRL`, `extractEmbeddedJson`, `stripTracking`), `KabumAdapter` (`__NEXT_DATA__`, canonical `/produto/<id>`), registered in `stores/index.ts`; manifest-driven fixture tests incl. a synthetic, labelled blocked fixture. Live `POST /probe` against kabum.com.br returned the expected price/Pix/stock.
- Step 7b: `MercadoLivreAdapter` (page state `_n.ctx.r`, brace-aware parse; Pix from the price breakdown; blocked by final URL or `negative_traffic`; item id from bookmark, page id fallback), manifest-driven fixture tests. Live probe from this IP: `blocked`, detection works end to end.
- Step 8: multi-stage `Dockerfile` (`slim` target, uid 10001, `/data`, healthcheck, `pricewatch` wrapper as entrypoint), `.dockerignore`, `docker-compose.yml` (`stop_grace_period: 20s`). Runtime stage verified in a container: non-root, health, `run` exit, graceful stop, sizes (spec 14, C1). The sandbox's container network intercepts TLS, so `docker build` of the `deps`/`build` stages failed on `SELF_SIGNED_CERT_IN_CHAIN`; run `docker build --target slim .` once on a normal network.
- `PW_FETCH_FIXTURES_DIR` (REQ-DX-009): `FixturesFetcher`. Verified end to end on the built binary, offline: Kabum fixture listing + `target_price` rule + signed webhook channel → one alert on `POST /run`, none on the second run.
- Leftovers slice: `pnpm req` prints acceptance blocks (ranges like `ALR-010 to 013` included); `migrate` CLI test; pino logging (`src/common/logger.ts`, `nestjs-pino` in `ApiModule` with `Authorization` redacted, `run`/`serve` log JSON via pino, `PW_LOG_LEVEL`); scripts `test:live` (`vitest.live.config.ts`, `test/live/`), `fixtures:capture` and `dev:seed` (`scripts/`, both build first and run against `dist/`). Fixed: `serve --no-cron` was ignored (commander stores it as `cron=false`).
- `/simplify` done over the leftovers slice. `?probe=true` now goes through `CycleService.checkNow` (same persistence, backoff and `price.observed` as a scheduled check, no run or lock), so rules see the first observation immediately. Side effect: a failed probe now counts toward `consecutive_failures`.
- Fixtures: `test/fixtures/kabum/` (3 in stock, out of stock, not found), `test/fixtures/mercadolivre/` (blocked, out of stock, in stock).

- Traceability slice: `test/integration/run-command.spec.ts` (REQ-RUN-003 exit codes 0/2/1, REQ-DB-005, REQ-NOT-003); `serve --no-cron` test retitled REQ-RUN-002. `pnpm req:check`: 37 MUST without tests (down from 40). Second slice: `test/unit/container.spec.ts` (REQ-CNT-001..006, 009..011 as static Dockerfile/compose/.env.example checks), REQ-API-005 and REQ-API-012 in `api.spec.ts`; now 26; the rest are mostly REQ-CNT-*, REQ-API-005/012, REQ-DX-*, REQ-TST-*, M2 browser items. Node here is 22 (install with `--config.engine-strict=false`).

## Next action
0. `pnpm req:check` is at 26 MUST without tests. Left: REQ-RUN-001 (serve + ticker, needs a test), REQ-DB-001, FET-002/004 (M2 browser), ADP-010 (spec 14 record), and process items DX-*/TST-* (tooling, not unit-testable; decide whether `req-check` should whitelist them).
Waiting on the user (blocked flows, to retry from another network): Mercado Livre `http` live read, full `docker build`. Meanwhile, not blocked:
1. Run `pnpm test:live` and `pnpm fixtures:capture kabum <url>` once on a normal network (both written, only dry-run offline).
2. After ML works: end-to-end run with real stores.

## Fixture gaps (REQ-ADP-007)
- Kabum: complete (blocked is synthetic and labelled). No real product without a Pix discount; that case is covered by an inline unit test.
- Mercado Livre: fixtures complete (blocked, out of stock, in stock). Still confirm `http` can ever get a product page; from this WSL IP it got `/gz/account-verification` (HTTP 200). M1 risk: if it stays blocked, ML needs the `api` (token) or `browser` strategy.

## Rules to carry forward
- Alerts design notes: `new_low` re-arms as soon as the price stops being a new low; a new low suppressed by cooldown is not retried unless it keeps getting lower (spec ALR-013 as written). `AlertsService` excludes a pending product's latest observation from `new_low` history so retries stay correct. `failing` listings are excluded from best price (glossary says "active").
- ML price comes from the page state, never JSON-LD (see §14 A1).
- Biome: run `./node_modules/.bin/biome check --write src test` to autofix; `pnpm exec biome ... --write` silently did nothing.
- Evaluators must ignore `inStock=false` observations: out-of-stock pages keep stale prices (Kabum) or price 0 (ML).
- `BlockedError` for ML keys on the final URL `/gz/account-verification` / body marker `negative_traffic`, not on the status code.

## Blockers
- ML `http` is blocked from this WSL IP (confirmed again via the built app). If it stays blocked, create an ML app (`PW_MELI_CLIENT_ID/SECRET`) and add an `api` strategy, or defer ML to M2 `browser`.
