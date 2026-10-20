# Progress

Handoff between sessions. Keep it short; update at the end of every slice (REQ-DX-018).

## Current step
Step 1 (scaffold) nearly done; step 2 (config + db) next. See docs/specs/09-dx.md §15.2.

## Done
- Spec v0.4 split by area, reviewed (decisions R1–R7 in docs/specs/08-scope-and-open-items.md).
- Agent setup: `.claude/settings.json`, `store-investigator` subagent (needs a session restart to register), RTK hook, Context7 MCP, `Concise` output style (local). `mise.toml` pins Node 24.
- Scaffold: CLI stub (`src/main.ts`, `src/cli/`), `package.json`, tsconfig, Vitest + `unplugin-swc`, Biome, lefthook, `pnpm req` / `req:check`, `.env.example`. DI smoke test passes (REQ-DX-003); `pnpm check` green.
- A6 (Kabum) closed; A1 (Mercado Livre) fixtures done, `http` viability open. Details and fixtures in §14.
- Fixtures: `test/fixtures/kabum/` (3 in stock, out of stock, not found), `test/fixtures/mercadolivre/` (blocked, out of stock, in stock).

## Next action
1. Finish step 1: remaining scripts (`test:live`, `fixtures:capture`, `dev:seed`, `db:generate`), `req` should print the acceptance block (REQ-DX-005), README/AGPL license file.
2. Step 2: zod config + `DbModule` + migrations + `migrate`.

## Fixture gaps (REQ-ADP-007)
- Kabum: blocked/captcha (synthetic, labelled), plus a product without a Pix discount (`priceWithDiscount == price` → `pixPriceCents` null).
- Mercado Livre: fixtures complete (blocked, out of stock, in stock). Still confirm `http` can ever get a product page; from this WSL IP it got `/gz/account-verification` (HTTP 200). M1 risk: if it stays blocked, ML needs the `api` (token) or `browser` strategy.

## Rules to carry forward
- ML price comes from the page state, never JSON-LD (see §14 A1).
- Evaluators must ignore `inStock=false` observations: out-of-stock pages keep stale prices (Kabum) or price 0 (ML).
- `BlockedError` for ML keys on the final URL `/gz/account-verification` / body marker `negative_traffic`, not on the status code.

## Blockers
- ML `http` is blocked from this WSL IP: if it stays blocked, create an ML app (`PW_MELI_CLIENT_ID/SECRET`) or defer ML to M2 `browser`. Decide before step 7.
