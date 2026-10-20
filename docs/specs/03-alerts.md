## 8. Alerts

### 8.1 Rule types

All rules are defined **per product**.

| Type | `params` | Condition | Scope |
|---|---|---|---|
| `target_price` | `{ "targetCents": number }` | best product price ≤ `targetCents` | product |
| `new_low` | `{ "minHistoryDays": number }` (default 7) | best product price < lowest effective price ever observed in any listing of the product before this cycle, counting only observations with `in_stock = 1` | product |
| `back_in_stock` | `{}` | some listing went from `inStock=false` (previous observation) to `inStock=true` | per listing |

- **REQ-ALR-001 (MUST)** Evaluators are pure functions: `(rule, relevantObservations, previousState) → { fire: boolean, context, newState }`. No database or global clock access; "now" is a parameter.
- **REQ-ALR-002 (MUST)** `params` validation is done per type on rule creation and edit. `targetCents` > 0; `minHistoryDays` in [0, 365].
- **REQ-ALR-003 (MUST)** `new_low` does not fire while the product's first observation is less than `minHistoryDays` days old.
- **REQ-ALR-004** Reserved (was `percent_drop`, deferred; see section 13).
- **REQ-ALR-005 (MUST)** `back_in_stock` does not fire on a listing's first observation.
- **REQ-ALR-006 (MUST)** Only rules with `enabled = 1` of non-archived products are evaluated, and only for products with a new observation in the cycle or with `pendingDelivery` (ALR-015).

### 8.2 Deduplication and cooldown

Each rule keeps an `armed` / `triggered` state (in `rules.state`).

- **REQ-ALR-010 (MUST)** An **armed** rule whose condition is true fires, moves to `triggered` and records `last_triggered_at` and `lastNotifiedPriceCents` (in `state`). The transition only happens if delivery is confirmed (ALR-015).
- **REQ-ALR-011 (MUST)** A **triggered** rule whose condition becomes false again is re-armed, without notifying.
- **REQ-ALR-012 (MUST)** A **triggered** rule whose condition stays true notifies again **only** if the relevant price is below `lastNotifiedPriceCents`. In that case the cooldown is ignored.
- **REQ-ALR-013 (MUST)** Outside the REQ-ALR-012 case, no rule notifies twice within `cooldown_minutes` (or `PW_ALERT_COOLDOWN`), even if it was re-armed in that interval. A firing suppressed by the cooldown leaves the rule `armed`, and it is re-evaluated in the next cycle.
- **REQ-ALR-014 (MUST)** For `back_in_stock`, state (including `lastNotifiedPriceCents`) is kept **per listing** inside `rules.state`.
- **REQ-ALR-015 (MUST)** If delivery fails on **all** channels, the rule does not change state and gets `pendingDelivery = true`: it is re-evaluated in the next cycle even without a new observation. If the condition stops holding before then, the pending flag is discarded.

> **Acceptance REQ-ALR-010 to 013** (`target_price`, target R$ 2.000,00, cooldown 12h)
> 1. Given best price R$ 2.100 and the rule armed, when the cycle runs, then nothing is sent.
> 2. When the price drops to R$ 1.990, then a notification is sent and the state becomes `triggered`.
> 3. When, 1h later, the price is still R$ 1.990, then nothing is sent.
> 4. When, 2h later, the price drops to R$ 1.950, then a new notification is sent (price lower than the last notified).
> 5. When the price rises to R$ 2.050, then the rule is re-armed without notification.
> 6. When, 3h after step 4, the price returns to R$ 1.990, then nothing is sent (12h cooldown since step 4).
> 7. When, 13h after step 4, the price is still R$ 1.990, then a notification is sent.

### 8.3 Alert event

Single payload, used by all channels and stored in `notifications.payload`:

```json
{
  "version": 1,
  "event": "alert.triggered",
  "occurredAt": "2026-11-27T03:12:00.000Z",
  "rule": { "id": "01J...", "type": "target_price", "params": { "targetCents": 200000 } },
  "product": { "id": "01J...", "name": "Galaxy S25 FE 256 GB" },
  "listing": { "id": "01J...", "store": "kabum", "storeName": "KaBuM!", "url": "https://..." },
  "price": {
    "effectiveCents": 195000,
    "priceCents": 210000,
    "pixCents": 195000,
    "inStock": true,
    "previousEffectiveCents": 199000,
    "lowestEverCents": 195000
  },
  "reason": "Melhor preço R$ 1.950,00 abaixo do alvo R$ 2.000,00"
}
```

System events use `"event": "system.listing_failing"`, `"system.listing_recovered"` or `"system.test"`, with `listing` and `reason`.

- **REQ-ALR-020 (MUST)** `reason` is pt-BR text, with values formatted as BRL (`R$ 1.950,00`).
- **REQ-ALR-021 (MUST)** For product-scoped rules, `listing` is the listing with the best price.
