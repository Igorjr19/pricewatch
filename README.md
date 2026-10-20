# pricewatch

Self-hosted, single-user tool that monitors product prices in Brazilian online stores and notifies you (Telegram, SMTP or webhook) when a condition you defined is met.

> **Status: pre-alpha (milestone M1 in progress).** The monitoring cycle, the alert engine and the notification channels (Telegram, SMTP, webhook) are built and tested against fakes. The REST API (`src/api`) is built and tested; the real store adapters, the `serve`/`run` wiring and the Docker image are not there yet, so there is nothing to run end to end today. See [`docs/PROGRESS.md`](docs/PROGRESS.md) for the exact state.

## How it works

- A **product** groups one or more **listings** (a store URL). Each successful read of a listing is an **observation**.
- A **cycle** runs on a schedule: take the lock, read the listings that are due, evaluate the rules of the affected products, send notifications, write a summary, release the lock.
- **Rules** are per product:

  | Rule | Fires when |
  |---|---|
  | `target_price` | the best product price is at or below a target |
  | `new_low` | the best price is lower than anything seen before (after a minimum history) |
  | `back_in_stock` | a listing goes from out of stock to in stock |

- Alerts are deduplicated: a rule notifies once, re-arms when the condition clears, notifies again only for a strictly lower price, and respects a cooldown. If delivery fails on every channel, the rule is retried next cycle.
- Prices are integer BRL cents. The **effective price** is the lower of the cash price and the Pix price. Alert text is in pt-BR (`R$ 1.950,00`).
- All state lives in the database (libSQL: a local file or Turso), so the same image can run as a long-lived server or as a scheduled task that wakes up, runs one cycle and exits.

## Stores

| Store | Milestone | Status |
|---|---|---|
| KaBuM! | M1 | investigated, fixtures captured, adapter not written |
| Mercado Livre | M1 | investigated, fixtures captured; plain `http` hit an anti-bot challenge from a residential IP, so viability is still open |
| Magalu, Amazon | M2 | needs a browser fetcher |
| Samsung, Motorola | M3 | not investigated |

## Development

Requirements: Node 24 (`mise install` reads `mise.toml`) and pnpm.

```sh
pnpm install
pnpm check          # typecheck + Biome + tests, failures only
pnpm test <pattern> # one test or file
pnpm test:coverage  # enforces ≥90% on the evaluators and the scheduler
pnpm req REQ-ALR-012   # print a requirement from the spec
pnpm req:check         # MUST requirements with no test citing their ID
pnpm db:generate       # generate a Drizzle migration after editing src/db/schema.ts
```

Configuration is environment-only (`PW_*`, validated with zod at boot). Copy [`.env.example`](.env.example), which documents every variable.

The CLI has three commands: `pricewatch serve [--no-cron]`, `pricewatch run` and `pricewatch migrate`. Only `migrate` works today; `serve` and `run` are still stubs.

### Project layout

```
src/
  alerts/      pure evaluators (src/alerts/evaluators), AlertsService, rule params
  monitor/     adapter contract, collector, scheduler, run lock, cycle service
  api/         REST controllers, bearer auth, DTOs (`/api/v1`)
  notifications/  channel parser, Telegram/SMTP/webhook notifiers, NotificationService
  db/          Drizzle schema and database access
  config/      env parsing and validation
  cli/         nest-commander commands
test/          unit and integration tests, support fakes, store fixtures
docs/specs/    the specification, one file per area
drizzle/       generated SQL migrations
```

### Conventions

- The spec in [`docs/specs/`](docs/specs) is the source of truth; [`SPECS.md`](SPECS.md) is its index. Requirements have stable IDs (`REQ-ALR-012`); tests cite them in their `describe` titles.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); a hook enforces it.
- Tests never touch the network. Store pages live as sanitized fixtures in `test/fixtures/<store>/`.

## License

AGPL-3.0 (declared in `package.json`). The `LICENSE` file has not been added yet.
