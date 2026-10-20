# pricewatch — Specification (MVP)

> Index. The spec is split by area so the agent reads only what it needs. Section numbers (`section 8.2`, etc.) are global and stable. Every requirement has an ID `REQ-<AREA>-NNN`. To read a single requirement use `pnpm req <ID>` (REQ-DX-005) or open the area file.

**Status:** draft v0.4 · **License:** AGPL-3.0 · **Conventions (MUST/SHOULD/MAY, cents, UTC):** `docs/specs/00-overview-and-architecture.md` §0

| Sections | Content | File |
|---|---|---|
| §0–4 | Overview, glossary, technical decisions, architecture | `docs/specs/00-overview-and-architecture.md` |
| §5–6 | Data model and configuration | `docs/specs/01-data-and-config.md` |
| §7 | Monitor: cycle, scheduling, fetch, adapters | `docs/specs/02-monitor.md` |
| §8 | Alert rules, deduplication, event | `docs/specs/03-alerts.md` |
| §9 | Channels and notifications | `docs/specs/04-notifications.md` |
| §10 | REST API | `docs/specs/05-api.md` |
| §11 | Testing strategy | `docs/specs/06-testing.md` |
| §12 | Container | `docs/specs/07-container.md` |
| §13–14 | Out of scope, open items, decisions | `docs/specs/08-scope-and-open-items.md` |
| §15 | Developer experience and agentic development | `docs/specs/09-dx.md` |

ID prefixes by area: `DB`, `CFG` (01) · `RUN`, `CYC`, `SCH`, `FET`, `ADP` (02) · `ALR` (03) · `NOT` (04) · `API` (05) · `TST` (06) · `CNT` (07) · `DX` (09).
