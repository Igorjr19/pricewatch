## 11. Testing

### 11.1 Levels

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | Rule evaluators, `parseBRL`, `normalizeUrl`, channel parser, scheduling and backoff computation |
| Adapter contract | Vitest + fixtures | Each adapter against its saved pages |
| Integration | Vitest + `file::memory:` | Full cycle with `FakeAdapter`, `FakeNotifier` and a controlled clock |
| API e2e | Vitest + supertest | Routes, auth, validation and errors |
| Live (manual) | `pnpm test:live` | Real requests to the stores; never runs in CI |

- **REQ-TST-001 (MUST)** No test outside `test:live` makes a real network request. `HttpFetcher` is replaceable by a fake in tests.
- **REQ-TST-002 (MUST)** The clock is injected (`Clock`) in the scheduler, evaluators and cycle. Tests do not use `Date.now()` directly.
- **REQ-TST-003 (MUST)** Minimum 90% line coverage in `src/alerts/evaluators` and `src/monitor/scheduler.service.ts`.
- **REQ-TST-004 (MUST)** `describe` titles start with the covered requirement ID, e.g. `describe('REQ-ALR-012 ...')`.
- **REQ-TST-005 (MUST)** The acceptance scenario of 8.2 exists as a step-by-step integration test.

### 11.2 Adapter contract suite

- **REQ-TST-010 (MUST)** Each adapter has `test/fixtures/<adapter>/manifest.json` listing each fixture with source URL, capture date, strategy and the expected `ExtractResult` (or the expected error).
- **REQ-TST-011 (MUST)** A generic suite walks all manifests and verifies that `extract` produces exactly what is expected.
- **REQ-TST-012 (MUST)** The script `pnpm fixtures:capture <adapter> <url> [--browser]` (the `--browser` flag exists from M2 onward) saves the HTML and appends an entry to the manifest with the current extraction result for manual review.
- **REQ-TST-013 (MUST)** Fixtures contain no cookies, tokens or personal data. The script strips known analytics `<script>` tags and session headers.
