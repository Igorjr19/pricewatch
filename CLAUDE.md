# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**Start every session by reading `docs/PROGRESS.md`** (current build step and next action). Update it at the end of each slice (REQ-DX-018).

Greenfield. The repo currently holds only the spec (v0.4) and an empty README: **no code, no `package.json`, no tests**. The spec is the source of truth and wins over any code that contradicts it (§0). To change behavior, propose the spec change first. When closing an open item in §14, record the decision, date and fixture there.

**Language:** English for spec, code, comments, commits and docs. Only user-facing alert text (`reason`, Telegram/SMTP messages) is pt-BR, with values like `R$ 1.950,00` (REQ-ALR-020).

**Reading the spec cheaply:** `SPECS.md` is only an index. Content lives in `docs/specs/*.md`, one file per area, with global section numbers (`§8.2`). Read only the area file you are working on. For a single requirement use `pnpm req <ID|prefix>` (REQ-DX-005, after scaffold) or `grep -n "REQ-ALR-012" docs/specs/*.md`. Never read the whole spec.

`pricewatch`: self-hosted, single-user tool that monitors prices in Brazilian stores and notifies via Telegram, SMTP or webhook. License AGPL-3.0.

## Milestones (what to build now)

- **M1 = MVP:** adapters `kabum` and `mercadolivre`, `http` only. Cycle, alerts, notifications and API complete.
- **M2:** `magalu`, `amazon`, `BrowserFetcher` (Playwright) and the `full` image. Only after closing A4/A5.
- **M3:** `samsung`, `motorola`. Only after closing A2/A3.

Deferred, do not implement unless asked: `percent_drop` rule (REQ-ALR-004 reserved), Resend channel (REQ-NOT-012 reserved), management CLI (the MVP is managed through the REST API only), mandatory `arm64` build. Reserved IDs must not be reused.

## Stack and commands

Node 24 LTS, TypeScript strict, pnpm, NestJS, nest-commander, Drizzle + `@libsql/client`, zod (env), class-validator (DTOs), undici + cheerio, pino, Vitest (`unplugin-swc`, required for Nest DI) + supertest, Biome (lint and format), lefthook, ULID IDs.

Nothing is scaffolded yet; confirm real scripts in `package.json` once it exists. The spec (§15 and others) plans:

- `pnpm check`: typecheck + `biome check` + unit tests, failures only in the output. **Run before calling a task done.**
- `pnpm test <pattern>`: one test or file. `pnpm req:check`: MUST requirements with no test citing the ID.
- **Node 24 is mandatory** (REQ-DX-012), but the dev machine had Node 20.19.3 via mise: check `node -v` before scaffolding or running anything.
- `.claude/settings.json` exists: `PostToolUse` formats edited `.ts` files and `Stop` runs `pnpm check` when `src/test/scripts` changed (both no-ops until scaffold). Pre-commit (lefthook) runs the checks; commits must follow Conventional Commits (`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`, optional scope); do not put `REQ-*` IDs in commit messages.
- Single CLI: `pricewatch serve [--no-cron]`, `pricewatch run`, `pricewatch migrate`. `run` exits 0 (cycle completed, even with listing failures), 2 (lock busy) or 1 (fatal error).
- `pnpm test:live`: real store requests, manual, never in CI. All other tests must not touch the network (REQ-TST-001).
- `pnpm fixtures:capture <adapter> <url>` (`--browser` from M2): saves the HTML and appends to the adapter's `manifest.json`.
- Migrations: generated with drizzle-kit, versioned in `drizzle/`.
- Docker `slim` image on `node:24-slim`, non-root user `pricewatch` (uid 10001), volume `/data`.

## Architecture

Single process. The CLI starts `ApiModule` (+ `Ticker` if cron is on) or calls `CycleService` directly. A **cycle** is, in order (REQ-CYC-005): acquire `run_lock` → collect due listings → evaluate rules for affected products → send notifications → write summary → release lock.

Cross-file ideas:

- **Stateless:** all state lives in the database (libSQL: local `file:` or `libsql://` Turso). The same image runs as a server or as a scheduled task that wakes, runs and exits. Keep no in-memory state across cycles. The lock is a single row (`run_lock`, `expires_at`); an expired lock can be taken over.
- **Collection decoupled from alerts:** `MonitorModule` knows nothing about rules. `AlertsModule` consumes observations through the in-process `price.observed` event, per cycle.
- **Model:** `Product` groups `Listing`s (URL + adapter). Each successful read is an `Observation`. Every attempt, good or bad, is a `fetch_attempt`.
- **Adapters** (`src/monitor/adapters/stores/`) implement `StoreAdapter` (`normalizeUrl`, `extract`, ordered `strategies`) and typed errors `BlockedError`, `NotFoundError`, `ParseError`. The registry resolves the adapter by hostname. Never persist an invented observation: with neither price nor stock, throw `ParseError`.
- **Evaluators** (`src/alerts/evaluators/`) are pure functions `(rule, observations, previousState) → {fire, context, newState}`. No database or clock access; "now" is a parameter.
- **Rule state and dedup:** `armed`/`triggered` in `rules.state` (JSON), per listing for per-listing rules. If the cooldown suppresses a firing, the rule stays `armed`. If delivery fails on **all** channels, state does not advance and `pendingDelivery` forces re-evaluation next cycle (REQ-ALR-015). The §8.2 acceptance scenario must exist as a step-by-step integration test.
- **Channels** are defined by env as URLs (`PW_CHANNEL_<NAME>=telegram://…` | `smtp(s)://…` | `webhook+https://…`). Parsing and validation run at boot. A failure on one channel does not block the others.
- **Backoff and status:** failure → `consecutive_failures++` with exponential backoff up to `PW_MAX_BACKOFF`. At `PW_FAILING_THRESHOLD` the listing becomes `failing` and a system notification is sent once. `strategy_unavailable` is not a failure.

## Non-obvious conventions

- **Money:** always integer BRL cents. API fields carry the `Cents` suffix. Use `parseBRL` to extract values from pages.
- **Effective price** = the lower of `pixPriceCents` and `priceCents`, ignoring nulls. It is the basis of all rules. `pixPriceCents` is only set when the store explicitly shows a distinct Pix price.
- **Time:** database always UTC ISO 8601; `PW_TZ` only formats messages. `Clock` is injected in scheduler, evaluators and cycle; tests do not use `Date.now()`.
- **Traceability:** tests reference `REQ-*` IDs (commits do not; they use Conventional Commits). `describe` titles start with the ID (`describe('REQ-ALR-012 …')`). Minimum 90% coverage in `src/alerts/evaluators` and `src/monitor/scheduler.service.ts`.
- **Adapters:** before implementing one, save a real page in `test/fixtures/<adapter>/` and record the chosen strategy and data source in §14 (REQ-ADP-010). At least 3 fixtures per adapter: in stock, out of stock, blocked/captcha, all listed in `manifest.json`. Fixtures must not contain cookies, tokens or personal data.
- **Secrets:** never in logs or API responses (mask as `tele***`). API token compared in constant time.
- **Configuration:** env only (`PW_*`), validated with zod at boot, listing each invalid variable and exiting with code 1. `.env.example` must document every variable in §6.1.
- **Redirects** in `HttpFetcher` stay within the same adapter's domains.

## Working practices (context economy)

- **Build order:** follow §15.2 (`docs/specs/09-dx.md`): scaffold and DX, config/db, cycle with `FakeAdapter`/`FakeNotifier`, evaluators, notifiers, API, then the real M1 adapters, then Docker. Do not start with scraping.
- **Store HTML is large.** Never dump fixtures or pages into the main context; use `grep`/`jq`/selectors to extract only the price snippet. Investigations A1–A6 (finding each store's data source) go to the `store-investigator` subagent (`.claude/agents/`), which returns only the conclusion and the fixture path; the main session records the decision in §14.
- When a slice of work is done, run `/simplify` and `/code-review`. After the first sessions, run `/fewer-permission-prompts` to cut approvals for read-only commands.

## Tooling already wired

- **RTK** filters Bash output through a `PreToolUse` hook (`.claude/settings.json`, REQ-DX-014). It rewrites `git`, `tsc`, `biome`, `vitest`, `grep`, `ls`, but not `pnpm` scripts, so keep `package.json` scripts terse (failures only). Check savings with `rtk gain`.
- **Context7** MCP is configured in `.mcp.json` (REQ-DX-015). Use it only for library APIs (NestJS, Drizzle, libSQL, Vitest, Biome, zod), passing the library ID and version. Never send secrets or project code in queries.
- **Output style:** the user runs `Concise` (local setting). Keep replies short; full detail for errors, security warnings and destructive confirmations.
