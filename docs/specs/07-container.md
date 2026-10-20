## 12. Container

- **REQ-CNT-001 (MUST)** A single multi-stage `Dockerfile`. In the MVP only the `slim` target (no browser); the `full` target (Playwright, Chromium and dependencies) lands in M2.
- **REQ-CNT-002 (MUST)** Base `node:24-slim` (Debian). Runtime as non-root user `pricewatch` (uid 10001).
- **REQ-CNT-003 (MUST)** `ENTRYPOINT ["pricewatch"]`, `CMD ["serve"]`. `docker run <img> run` executes one cycle.
- **REQ-CNT-004 (MUST)** Volume `/data` declared and owned by `pricewatch`.
- **REQ-CNT-005 (MUST)** `HEALTHCHECK` calling `GET /health` (ignored when the command is not `serve`).
- **REQ-CNT-006 (MUST)** Build `linux/amd64`. (SHOULD) `linux/arm64` via manual `buildx`, since CI is out of scope.
- **REQ-CNT-007 (SHOULD)** `slim` image under 250 MB; `slim` memory in idle `serve` under 200 MB. Measure as soon as the first `Dockerfile` exists; if the target is missed, record it in section 14.
- **REQ-CNT-008 (SHOULD)** `pricewatch run` on the `slim` image, with a migrated local database and no due listing, finishes in under 3 s.
- **REQ-CNT-009 (MUST)** Example `docker-compose.yml` with the `pricewatch` service (`slim`), `stop_grace_period: 20s`, mounting `./data:/data` and reading `.env`. The `full` profile lands in M2.
- **REQ-CNT-010 (MUST)** `.env.example` documents all variables from section 6.1 with their defaults.
- **REQ-CNT-011 (MUST)** Image tags: `pricewatch:<version>` and `:latest` for `slim`; `pricewatch:<version>-full` and `:full` for `full` (from M2 onward).
