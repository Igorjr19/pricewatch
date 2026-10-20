# pricewatch — Specification (MVP)

> Source document for spec-driven development. Every requirement has a stable ID (`REQ-<AREA>-NNN`) and Given/When/Then acceptance criteria. Tests and commits must reference these IDs.

**Status:** draft v0.4 (reviewed; see 14.1 and section 15) · **Project license:** AGPL-3.0 · **Date:** 2026-10-20

---

## 0. How to read this document

- **MUST**: mandatory for the MVP. The MVP is not done without it.
- **SHOULD**: expected in the MVP; may be postponed with a justification recorded in section 14.
- **MAY**: optional, or marks an extension point.
- Monetary values are always **integer BRL cents** (`R$ 1.234,56` → `123456`).
- Dates in the database are always **UTC, ISO 8601**. The timezone (`PW_TZ`) is only used to format messages.
- When a requirement conflicts with existing code, the requirement wins. Change the code or propose a spec change.
- The project language is English (spec, code, comments, commits). User-facing alert text stays pt-BR (REQ-ALR-020), as do store-facing request headers (REQ-FET-001).

## 1. Overview

`pricewatch` is a **self-hosted, single-user** tool that monitors product prices in Brazilian online stores and notifies through configurable channels when a user-defined condition is met.

Principles:

1. **One container, configured by env.** `docker run` with one volume and one `.env` must be enough.
2. **Stateless by default.** All state lives in the database, so the same image runs as a long-lived server or as a scheduled task that wakes up, runs and exits (cold start).
3. **Monitoring decoupled from alerts.** Collection knows nothing about rules. Rules consume observations.
4. **Platform agnostic.** No cloud provider SDK in the code.

### 1.1 MVP scope

- REST API for registration and queries
- Monitor: scheduled collection, per-store adapters, HTTP fetch (browser fallback lands in milestone M2)
- Alerts: 3 rule types (`target_price`, `new_low`, `back_in_stock`), deduplication, cooldown
- Notifications: Telegram, email via SMTP, generic webhook
- Docker `slim` image (the browser-enabled `full` image lands in M2), example compose file
- Test strategy with per-store fixtures

### 1.2 Out of scope for the MVP

See section 13.

## 2. Glossary

| Term | Definition |
|---|---|
| **Product** | Canonical item the user wants to buy ("Galaxy S25 FE 256 GB"). Groups listings. |
| **Listing** | The same product in a specific store: a URL tied to an adapter. |
| **Observation** | One successful read of a listing at a point in time: prices, stock and seller. |
| **Fetch attempt** | Every read attempt, successful or not. Used for diagnostics. |
| **Effective price** | The lower of `pixPriceCents` and `priceCents`, ignoring nulls. Basis of all rules. |
| **Best product price** | Lowest effective price among the product's listings, considering only each listing's most recent observation, for listings that are active and `inStock = true`. |
| **Adapter** | Module that knows how to extract data from one store. |
| **Strategy** | How the page is obtained: `api`, `http` or `browser`. |
| **Cycle** | One full execution: collect due listings → evaluate rules → send notifications. |
| **Channel** | Notification destination configured by env (a Telegram bot, an email, a webhook). |

## 3. Technical decisions

| # | Decision | Reason |
|---|---|---|
| D1 | **Node.js 24 LTS**, **TypeScript strict**, **pnpm** | Active LTS; strict mode reduces agent errors |
| D2 | **NestJS** as the framework | Author familiarity; modules and DI give agents a predictable pattern |
| D3 | **Drizzle ORM** + **libSQL** (`@libsql/client`) | Same dialect for local file (`file:`) and remote (`libsql://`, Turso) |
| D4 | Migrations generated with **drizzle-kit**, versioned in `drizzle/` | Reviewable SQL in PRs |
| D5 | **nest-commander** for the CLI (`serve`, `run`, `migrate`) | One binary, several modes |
| D6 | **zod** to validate env at boot | Fail fast with a clear message |
| D7 | **class-validator** + **class-transformer** for API DTOs | NestJS standard |
| D8 | **undici** (native fetch) for HTTP; **cheerio** for HTML parsing | Light, no browser |
| D9 | **Playwright** (Chromium) only in the `full` image or via `ws://`. **Deferred to M2** | A browser is expensive; only needed once a store requires it |
| D10 | **pino** via `nestjs-pino`, JSON logs | Compatible with any collector |
| D11 | **Vitest** (`globals: true`) + **`unplugin-swc`** + **supertest**; coverage with `@vitest/coverage-v8` | Native TS/ESM and fast watch; SWC emits `emitDecoratorMetadata`, required by Nest DI |
| D12 | IDs as text **ULID** | Time-sortable, URL-safe |
| D13 | Adapters **in code** with shared helpers (JSON-LD, CSS, embedded JSON) | Declarative YAML adapters are left for v2 |
| D14 | Channels configured as a **URL per env var** | One variable per channel, easy to document |
| D15 | API authentication via **static bearer token** | Single user, no UI |
| D16 | **Biome** for lint and formatting | One fast tool, short output |
| D17 | **lefthook** for git hooks | No Node runtime dependency in hooks beyond pnpm |

## 4. Architecture

```
┌──────────────────────────── single process ────────────────────────────┐
│                                                                         │
│  CLI (nest-commander)                                                   │
│   ├─ serve [--no-cron] ──► ApiModule (HTTP)  +  Ticker (if cron on)     │
│   ├─ run ──────────────────────────────┐                                │
│   └─ migrate                           ▼                                │
│                                 CycleService                            │
│                    ┌──────────────┼──────────────────┐                  │
│                    ▼              ▼                  ▼                  │
│             MonitorModule    AlertsModule      NotifiersModule          │
│          (scheduler, fetch,  (evaluates rules, (telegram, smtp,         │
│           adapters, persist)  deduplicates)     webhook)                │
│                    │              ▲                                     │
│                    └── price.observed event (in-process, per cycle)     │
│                                                                         │
│                         DbModule (Drizzle + libSQL)                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Directory layout

```
pricewatch/
├── src/
│   ├── main.ts                    # nest-commander bootstrap
│   ├── cli/                       # serve, run, migrate commands
│   ├── config/                    # zod schema + typed ConfigService
│   ├── db/
│   │   ├── schema.ts              # Drizzle tables
│   │   └── db.module.ts
│   ├── monitor/
│   │   ├── scheduler.service.ts   # selects due listings, computes next_check_at
│   │   ├── fetch/                 # HttpFetcher, BrowserFetcher, per-domain rate limit
│   │   └── adapters/
│   │       ├── adapter.interface.ts
│   │       ├── registry.ts
│   │       ├── helpers/           # jsonld.ts, css.ts, embedded-json.ts, money.ts
│   │       └── stores/            # amazon.ts, kabum.ts, magalu.ts, mercadolivre.ts, samsung.ts, motorola.ts
│   ├── alerts/
│   │   ├── evaluators/            # one file per rule type, pure functions
│   │   └── alerts.service.ts
│   ├── notifiers/
│   │   ├── notifier.interface.ts
│   │   ├── channel-parser.ts      # env URL → channel config
│   │   └── telegram.ts, smtp.ts, webhook.ts
│   ├── cycle/cycle.service.ts     # orchestrates a cycle, lock, timeout
│   └── api/                       # controllers + DTOs
├── drizzle/                       # SQL migrations
├── test/
│   ├── fixtures/<adapter>/*.html  # saved pages
│   ├── contract/                  # adapter contract suite
│   └── e2e/
├── scripts/                       # req.ts, req-check.ts, fixtures-capture.ts, dev-seed.ts
├── docs/specs/                    # the specification, split by area
├── .claude/                       # settings, hooks, subagents (REQ-DX-008, DX-013)
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── SPECS.md                       # spec index
```
