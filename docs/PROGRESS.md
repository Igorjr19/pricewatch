# Progress

Handoff between sessions. Keep it short; update at the end of every slice (REQ-DX-018).

## Current step
Step 1 (scaffold) nearly done; step 2 (config + db) done except `PW_AUTO_MIGRATE` wiring in `serve`/`run` (REQ-DB-005). Steps 3 (cycle with fakes) and 4 (evaluators + AlertsService, §8.2 test) done. Step 5 (notifiers + channel parser) next; CLI wiring waits for it. See docs/specs/09-dx.md §15.2.

## Done
- Spec v0.4 split by area, reviewed (decisions R1–R7 in docs/specs/08-scope-and-open-items.md).
- Agent setup: `.claude/settings.json`, `store-investigator` subagent (needs a session restart to register), RTK hook, Context7 MCP, `Concise` output style (local). `mise.toml` pins Node 24.
- Scaffold: CLI stub (`src/main.ts`, `src/cli/`), `package.json`, tsconfig, Vitest + `unplugin-swc`, Biome, lefthook, `pnpm req` / `req:check`, `.env.example`. DI smoke test passes (REQ-DX-003); `pnpm check` green.
- A6 (Kabum) closed; A1 (Mercado Livre) fixtures done, `http` viability open. Details and fixtures in §14.
- Step 2: zod config (`src/config/`), Drizzle schema + first migration (`src/db/`, `drizzle/`), `migrate` command, DB integration tests (REQ-DB-002/003/004).
- Step 3: `Clock`, adapter contract + `AdapterRegistry`, `FakeAdapter`, `SchedulerService`, `RunLockService`, `CollectorService` (strategy loop, outcomes), `CycleService` (lock, due selection, concurrency, domain delay, timeout, abort, failing/recovered notices). Ports in `src/monitor/ports.ts` (`PageFetcher`, `AlertsPort`, `SystemNotifier`). 71 tests green.
- Step 4: pure evaluators (`src/alerts/evaluators/`, state per unit: product, or listing for `back_in_stock`), `AlertsService` implementing `AlertsPort` (rule selection ALR-006, history queries, dedup/cooldown, ALR-015 pending retry), `AlertDelivery` port (`src/alerts/events.ts`), params validation (`params.ts`), BRL formatting. §8.2 scenario passes both on the evaluator and end to end through `CycleService`. `pnpm test:coverage` enforces ≥90% on evaluators and scheduler (currently 99% / 98%).
- Fixtures: `test/fixtures/kabum/` (3 in stock, out of stock, not found), `test/fixtures/mercadolivre/` (blocked, out of stock, in stock).

## Next action
0. Leftovers: `run`/`serve` CLI wiring (Nest providers, `PW_AUTO_MIGRATE`, exit codes 0/2/1, SIGTERM 15 s) waits for a real `PageFetcher` + notifier. `migrate` command is untested end to end. REQ-DB-006 (retention pruning) lands with the cycle wiring.
0. Step 2 leftovers: `migrate` command is untested end to end (no `tsx`/build run yet); REQ-DB-005 and REQ-DB-006 (retention) land with the cycle.
1. Finish step 1: remaining scripts (`test:live`, `fixtures:capture`, `dev:seed`, `db:generate`), `req` should print the acceptance block (REQ-DX-005), README/AGPL license file.
2. Step 5: channel URL parser (telegram/smtp/webhook) validated at boot, `Notifier` implementations, `AlertDelivery` + `SystemNotifier` backed by them (writes `notifications` rows, masks secrets), system notices.

## Fixture gaps (REQ-ADP-007)
- Kabum: blocked/captcha (synthetic, labelled), plus a product without a Pix discount (`priceWithDiscount == price` → `pixPriceCents` null).
- Mercado Livre: fixtures complete (blocked, out of stock, in stock). Still confirm `http` can ever get a product page; from this WSL IP it got `/gz/account-verification` (HTTP 200). M1 risk: if it stays blocked, ML needs the `api` (token) or `browser` strategy.

## Rules to carry forward
- Alerts design notes: `new_low` re-arms as soon as the price stops being a new low; a new low suppressed by cooldown is not retried unless it keeps getting lower (spec ALR-013 as written). `AlertsService` excludes a pending product's latest observation from `new_low` history so retries stay correct. `failing` listings are excluded from best price (glossary says "active").
- ML price comes from the page state, never JSON-LD (see §14 A1).
- Biome: run `./node_modules/.bin/biome check --write src test` to autofix; `pnpm exec biome ... --write` silently did nothing.
- Evaluators must ignore `inStock=false` observations: out-of-stock pages keep stale prices (Kabum) or price 0 (ML).
- `BlockedError` for ML keys on the final URL `/gz/account-verification` / body marker `negative_traffic`, not on the status code.

## Blockers
- ML `http` is blocked from this WSL IP: if it stays blocked, create an ML app (`PW_MELI_CLIENT_ID/SECRET`) or defer ML to M2 `browser`. Decide before step 7.
