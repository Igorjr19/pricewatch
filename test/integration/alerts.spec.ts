import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuleState } from '../../src/alerts/evaluators/types.js';
import { listings, rules } from '../../src/db/schema.js';
import { fakeResult } from '../../src/monitor/adapters/fake.adapter.js';
import { type Harness, HOUR, makeHarness } from '../support/harness.js';

const URL_A = 'https://fake.test/a';

let harness: Harness | undefined;

afterEach(() => {
  harness?.handle.close();
  harness = undefined;
});

async function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  harness = await makeHarness({ realAlerts: true, ...options });
  return harness;
}

/** Scripts the next price for the listing, makes it due and runs one cycle. */
async function cycle(
  h: Harness,
  listingId: string,
  url: string,
  priceCents: number,
  inStock = true,
) {
  h.adapter.script(url, fakeResult({ priceCents, inStock }));
  await h.makeDue(listingId);
  return h.cycle.run('cli');
}

async function stateOf(h: Harness, ruleId: string) {
  return (await h.ruleState(ruleId)) as RuleState | null;
}

describe('REQ-ALR-010 to REQ-ALR-013 acceptance scenario, end to end through the cycle', () => {
  it('target R$ 2.000,00, cooldown 12h, seven steps', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { cooldownMinutes: 720 },
    );
    const sent = () => h.delivery.requests.length;

    // 1. R$ 2.100, armed → nothing is sent.
    await cycle(h, listingId, URL_A, 210_000);
    expect(sent()).toBe(0);

    // 2. R$ 1.990 → notification, state becomes triggered.
    h.clock.advance(1 * HOUR);
    await cycle(h, listingId, URL_A, 199_000);
    expect(sent()).toBe(1);
    expect((await stateOf(h, ruleId))?.units.product).toMatchObject({
      status: 'triggered',
      lastNotifiedPriceCents: 199_000,
    });

    // 3. 1h later, still R$ 1.990 → nothing.
    h.clock.advance(1 * HOUR);
    await cycle(h, listingId, URL_A, 199_000);
    expect(sent()).toBe(1);

    // 4. 2h later, R$ 1.950 → lower than the last notified: notifies again.
    h.clock.advance(2 * HOUR);
    await cycle(h, listingId, URL_A, 195_000);
    expect(sent()).toBe(2);

    // 5. R$ 2.050 → re-armed, no notification.
    h.clock.advance(1 * HOUR);
    await cycle(h, listingId, URL_A, 205_000);
    expect(sent()).toBe(2);
    expect((await stateOf(h, ruleId))?.units.product?.status).toBe('armed');

    // 6. 3h after step 4, R$ 1.990 → suppressed by the 12h cooldown.
    h.clock.advance(2 * HOUR);
    await cycle(h, listingId, URL_A, 199_000);
    expect(sent()).toBe(2);
    expect((await stateOf(h, ruleId))?.units.product?.status).toBe('armed');

    // 7. 13h after step 4, still R$ 1.990 → notification.
    h.clock.advance(10 * HOUR);
    await cycle(h, listingId, URL_A, 199_000);
    expect(sent()).toBe(3);
    expect((await stateOf(h, ruleId))?.units.product?.status).toBe('triggered');
  });
});

describe('alert event payload (spec 8.3)', () => {
  it('carries the rule, product, best listing, prices and a pt-BR reason', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { channels: ['phone', 'mail'] },
    );
    h.adapter.script(
      URL_A,
      fakeResult({ priceCents: 210_000, pixPriceCents: 195_000 }),
    );
    await h.makeDue(listingId);

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({ summary: { notificationsSent: 2 } });
    const [request] = h.delivery.requests;
    expect(request).toMatchObject({
      ruleId: 'R1',
      listingId,
      channels: ['phone', 'mail'],
    });
    expect(request?.event).toMatchObject({
      version: 1,
      event: 'alert.triggered',
      rule: { type: 'target_price', params: { targetCents: 200_000 } },
      product: { id: 'P1', name: 'Product 1' },
      listing: {
        id: listingId,
        store: 'fake',
        storeName: 'Fake store',
        url: URL_A,
      },
      price: {
        effectiveCents: 195_000,
        priceCents: 210_000,
        pixCents: 195_000,
        inStock: true,
      },
      reason: 'Melhor preço R$ 1.950,00 abaixo do alvo R$ 2.000,00',
    });
  });

  it('records last_triggered_at on the rule when delivered', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });
    await cycle(h, listingId, URL_A, 190_000);
    const [row] = await h.handle.db
      .select()
      .from(rules)
      .where(eq(rules.id, ruleId));
    expect(row?.lastTriggeredAt).toBe(h.clock.now().toISOString());
  });
});

describe('REQ-ALR-015 delivery failure', () => {
  it('keeps the state, marks pending, and retries next cycle without a new observation', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });
    h.delivery.failAll = true;

    await cycle(h, listingId, URL_A, 190_000);
    let unit = (await stateOf(h, ruleId))?.units.product;
    expect(unit).toMatchObject({
      status: 'armed',
      pendingDelivery: true,
      lastTriggeredAt: null,
    });
    const [row] = await h.handle.db
      .select()
      .from(rules)
      .where(eq(rules.id, ruleId));
    expect(row?.lastTriggeredAt).toBeNull();

    // Next cycle: nothing is due, so there is no new observation. The pending flag forces re-evaluation.
    h.delivery.failAll = false;
    h.clock.advance(5 * 60_000);
    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({
      summary: { listingsDue: 0, notificationsSent: 1 },
    });
    unit = (await stateOf(h, ruleId))?.units.product;
    expect(unit).toMatchObject({
      status: 'triggered',
      pendingDelivery: false,
      lastNotifiedPriceCents: 190_000,
    });
  });

  it('discards the pending flag when the condition stops holding before delivery works', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });
    h.delivery.failAll = true;
    await cycle(h, listingId, URL_A, 190_000);

    h.delivery.failAll = false;
    h.clock.advance(1 * HOUR);
    await cycle(h, listingId, URL_A, 250_000);

    expect(h.delivery.requests).toHaveLength(1); // only the failed attempt
    expect((await stateOf(h, ruleId))?.units.product).toMatchObject({
      status: 'armed',
      pendingDelivery: false,
    });
  });

  it('delivers when at least one channel works', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { channels: ['phone', 'mail'] },
    );
    h.delivery.failChannels.add('phone');

    const result = await cycle(h, listingId, URL_A, 190_000);

    expect(result).toMatchObject({ summary: { notificationsSent: 1 } });
    expect((await stateOf(h, ruleId))?.units.product).toMatchObject({
      status: 'triggered',
      pendingDelivery: false,
    });
  });
});

describe('REQ-ALR-006 which rules are evaluated', () => {
  it('skips disabled rules and rules of archived products', async () => {
    const h = await setup();
    const a = await h.addListing(URL_A);
    await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { enabled: false },
    );
    const b = await h.addListing('https://fake.test/b');
    await h.addRule('P2', 'target_price', { targetCents: 200_000 });
    // Archiving happens after the observation was due but before evaluation: archived products are skipped.
    await h.archiveProduct('P2');
    h.adapter
      .script(URL_A, fakeResult({ priceCents: 100_000 }))
      .script('https://fake.test/b', fakeResult({ priceCents: 100_000 }));
    await h.makeDue(a);
    await h.makeDue(b);

    await h.cycle.run('cli');

    expect(h.delivery.requests).toHaveLength(0);
  });

  it('only evaluates products that had a new observation (or are pending)', async () => {
    const h = await setup();
    const a = await h.addListing(URL_A);
    await h.addListing('https://fake.test/b');
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });
    await h.addRule('P2', 'target_price', { targetCents: 200_000 });
    h.adapter.script(URL_A, fakeResult({ priceCents: 100_000 }));
    // Listing b is not due: no observation, so its rule is not evaluated even though it would match.
    await h.handle.db
      .update(listings)
      .set({ nextCheckAt: '2999-01-01T00:00:00.000Z' })
      .where(eq(listings.id, 'L2'));
    await h.makeDue(a);

    await h.cycle.run('cli');

    expect(h.delivery.requests.map((r) => r.event.product.id)).toEqual(['P1']);
  });

  it('skips a rule with invalid stored params instead of guessing', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: -5 });
    await cycle(h, listingId, URL_A, 1);
    expect(h.delivery.requests).toHaveLength(0);
  });
});

describe('REQ-ALR-021 and cross-listing prices', () => {
  it('reports the cheapest in-stock listing of the product', async () => {
    const h = await setup();
    const a = await h.addListing(URL_A);
    const b = await h.addListing('https://fake.test/b', { productId: 'P1' });
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });
    h.adapter
      .script(URL_A, fakeResult({ priceCents: 190_000 }))
      .script('https://fake.test/b', fakeResult({ priceCents: 180_000 }));
    await h.makeDue(a);
    await h.makeDue(b);

    await h.cycle.run('cli');

    expect(h.delivery.requests).toHaveLength(1);
    expect(h.delivery.requests[0]?.event.listing.id).toBe(b);
    expect(h.delivery.requests[0]?.event.price.effectiveCents).toBe(180_000);
  });

  it('ignores out-of-stock prices even when they are lower', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });
    await cycle(h, listingId, URL_A, 100_000, false);
    expect(h.delivery.requests).toHaveLength(0);
  });
});

describe('new_low across cycles', () => {
  it('fires on a lower price, using history from earlier cycles, not the current one', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'new_low', { minHistoryDays: 0 });

    await cycle(h, listingId, URL_A, 100_000); // first observation: nothing to beat
    expect(h.delivery.requests).toHaveLength(0);
    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 100_000); // equal, not lower
    expect(h.delivery.requests).toHaveLength(0);
    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 90_000);
    expect(h.delivery.requests).toHaveLength(1);
    expect(h.delivery.requests[0]?.event.reason).toBe(
      'Menor preço já registrado: R$ 900,00 (anterior R$ 1.000,00)',
    );
  });

  it('REQ-ALR-003 does not fire while the history is younger than minHistoryDays', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'new_low', { minHistoryDays: 7 });
    await cycle(h, listingId, URL_A, 100_000);
    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 90_000);
    expect(h.delivery.requests).toHaveLength(0);
  });
});

describe('back_in_stock across cycles', () => {
  it('REQ-ALR-005 ignores the first observation, fires on out → in, per listing', async () => {
    const h = await setup();
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'back_in_stock', {});

    await cycle(h, listingId, URL_A, 100_000, false); // first observation, out of stock
    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 100_000, false);
    expect(h.delivery.requests).toHaveLength(0);

    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 95_000, true);
    expect(h.delivery.requests).toHaveLength(1);
    expect(h.delivery.requests[0]?.event.reason).toBe(
      'Voltou ao estoque por R$ 950,00',
    );
    expect((await stateOf(h, ruleId))?.units[listingId]).toMatchObject({
      status: 'triggered',
    });

    h.clock.advance(4 * HOUR);
    await cycle(h, listingId, URL_A, 95_000, true); // still in stock: re-armed, silent
    expect(h.delivery.requests).toHaveLength(1);
    expect((await stateOf(h, ruleId))?.units[listingId]?.status).toBe('armed');
  });
});
