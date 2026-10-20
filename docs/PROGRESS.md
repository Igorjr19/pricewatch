# Progress

Handoff between sessions. Keep it short; update at the end of every slice (REQ-DX-018).

## Current step
Step 1 of the build order (docs/specs/09-dx.md §15.2): scaffold. **Not started.**

## Done
- Spec v0.4 split by area, reviewed (decisions R1–R7 in docs/specs/08-scope-and-open-items.md).
- Agent setup: `.claude/settings.json` (hooks, permissions), `store-investigator` subagent, RTK hook, Context7 MCP (`.mcp.json`), `Concise` output style (local).
- `mise.toml` pins Node 24.

## Next action
Scaffold per REQ-DX-001..008, DX-012, DX-017: Nest + nest-commander, Vitest with `unplugin-swc` and the DI smoke test (DX-003) first, Biome, lefthook, `req` / `req:check` scripts. Then step 2 (config + db).

## Investigation inputs (provided by the user; stock status unknown, the investigator classifies each)
Run A6 (Kabum) and A1 (Mercado Livre) with the `store-investigator` subagent, in parallel with the scaffold. Tracking params were stripped from the ML URLs (`matt_tool`, `origin`, `sid`, `wid`, `action`); `item_id` is kept because it identifies the offer.

- Kabum: https://www.kabum.com.br/produto/703054 · https://www.kabum.com.br/produto/1029920 · https://www.kabum.com.br/produto/1012762
- Mercado Livre: https://www.mercadolivre.com.br/p/MLB65503988?pdp_filters=item_id:MLB6288481376 · https://www.mercadolivre.com.br/p/MLB45524778?pdp_filters=item_id:MLB5264364150 · https://www.mercadolivre.com.br/p/MLB65938141?pdp_filters=item_id:MLB5286852103

If no URL turns out to be out of stock, ask the user for one (REQ-ADP-007 needs an out-of-stock fixture).

## Blockers
- Approve the Context7 project MCP server on the first prompt of the new session.
