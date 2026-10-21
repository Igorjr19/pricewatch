import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiModule } from '../../src/api/api.module.js';
import { safeEqual } from '../../src/api/auth.guard.js';
import { notifications } from '../../src/db/schema.js';
import { fakeResult } from '../../src/monitor/adapters/fake.adapter.js';
import { BlockedError } from '../../src/monitor/adapters/types.js';
import { SchedulerService } from '../../src/monitor/scheduler.service.js';
import { createNotificationService } from '../../src/notifications/factory.js';
import type { FetchFn } from '../../src/notifications/http.js';
import type { ChannelConfig } from '../../src/notifications/types.js';
import { type Harness, HOUR, MIN, makeHarness } from '../support/harness.js';

const TOKEN = 'api-secret-token';
const RUN_TOKEN = 'run-secret-token';
const BOT = '123456:ABCDEF-secret';
const URL_A = 'https://fake.test/a';

const channels: ChannelConfig[] = [
  { type: 'telegram', name: 'phone', botToken: BOT, chatId: '-100' },
];

let app: INestApplication | undefined;
let harness: Harness | undefined;
afterEach(async () => {
  await app?.close();
  harness?.handle.close();
  app = undefined;
  harness = undefined;
});

async function boot(
  options: { telegramStatus?: number; realAlerts?: boolean } = {},
) {
  const h = await makeHarness({ realAlerts: options.realAlerts });
  harness = h;
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    calls.push(url);
    return new Response('ok', { status: options.telegramStatus ?? 200 });
  };
  const notificationsService = createNotificationService({
    db: h.handle.db,
    clock: h.clock,
    channels,
    fetchFn,
  });
  const { CollectorService } = await import(
    '../../src/monitor/collector.service.js'
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      ApiModule.register({
        db: h.handle.db,
        clock: h.clock,
        registry: h.registry,
        collector: new CollectorService(
          h.clock,
          {
            async fetch() {
              throw new Error('no http');
            },
          },
          { browser: 'off' },
        ),
        scheduler: new SchedulerService(
          h.clock,
          {
            scrapeIntervalMs: 3 * HOUR,
            scrapeJitterMs: 20 * MIN,
            maxBackoffMs: 24 * HOUR,
          },
          () => 0.5,
        ),
        cycle: h.cycle,
        notifications: notificationsService,
        channels,
        apiToken: TOKEN,
        runToken: RUN_TOKEN,
        version: '1.2.3',
        browserAvailable: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  const http = request(app.getHttpServer());
  const auth = { Authorization: `Bearer ${TOKEN}` };
  return { h, http, auth, calls };
}

async function newProduct(
  http: ReturnType<typeof request>,
  auth: Record<string, string>,
  name = 'Galaxy',
) {
  const res = await http.post('/api/v1/products').set(auth).send({ name });
  return res.body.id as string;
}

describe('REQ-API-001 authentication', () => {
  it('rejects a missing or wrong token with 401 and the error envelope', async () => {
    const { http } = await boot();
    const missing = await http.get('/api/v1/products');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('unauthorized');
    const wrong = await http
      .get('/api/v1/products')
      .set('Authorization', 'Bearer nope');
    expect(wrong.status).toBe(401);
    const scheme = await http
      .get('/api/v1/products')
      .set('Authorization', TOKEN);
    expect(scheme.status).toBe(401);
  });

  it('accepts a case-insensitive scheme and ignores surrounding whitespace', async () => {
    const { http } = await boot();
    const res = await http
      .get('/api/v1/products')
      .set('Authorization', `bearer  ${TOKEN} `);
    expect(res.status).toBe(200);
  });

  it('GET /health needs no token', async () => {
    const { http } = await boot();
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', version: '1.2.3', db: 'ok' });
  });

  it('compares tokens without leaking length or prefix', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc\0', 'abc')).toBe(false);
  });

  it('the run token works only on POST /run', async () => {
    const { http } = await boot();
    const runToken = { Authorization: `Bearer ${RUN_TOKEN}` };
    expect((await http.post('/api/v1/run').set(runToken)).status).toBe(200);
    expect((await http.get('/api/v1/products').set(runToken)).status).toBe(401);
  });
});

describe('REQ-API-002 / REQ-API-003 errors and validation', () => {
  it('lists the invalid fields in details with a 400', async () => {
    const { http, auth } = await boot();
    const res = await http
      .post('/api/v1/products')
      .set(auth)
      .send({ name: '', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const fields = res.body.error.details.map(
      (d: { field: string }) => d.field,
    );
    expect(fields).toEqual(expect.arrayContaining(['name', 'extra']));
  });

  it('unknown ids are 404 in the envelope', async () => {
    const { http, auth } = await boot();
    const res = await http.get('/api/v1/products/nope').set(auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'not_found', message: 'Product not found' },
    });
  });
});

describe('products, listings and rules', () => {
  it('REQ-API-010 creates a listing, normalizes and rejects duplicates with 409', async () => {
    const { http, auth } = await boot();
    const id = await newProduct(http, auth);
    const created = await http
      .post(`/api/v1/products/${id}/listings`)
      .set(auth)
      .send({ url: URL_A });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      productId: id,
      adapterId: 'fake',
      url: URL_A,
      status: 'active',
    });
    const again = await http
      .post(`/api/v1/products/${id}/listings`)
      .set(auth)
      .send({ url: URL_A });
    expect(again.status).toBe(409);
    expect(again.body.error.details.listingId).toBe(created.body.id);
  });

  it('REQ-ADP-001 a URL with no adapter is 422 with the supported domains', async () => {
    const { http, auth } = await boot();
    const id = await newProduct(http, auth);
    const res = await http
      .post(`/api/v1/products/${id}/listings`)
      .set(auth)
      .send({ url: 'https://unknown.example/x' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.supportedDomains).toEqual(['fake.test']);
    const bad = await http
      .post(`/api/v1/products/${id}/listings`)
      .set(auth)
      .send({ url: 'not a url' });
    expect(bad.status).toBe(400);
  });

  it('REQ-API-011 ?probe=true persists the first observation', async () => {
    const { h, http, auth } = await boot();
    h.adapter.script(URL_A, fakeResult({ priceCents: 123_400 }));
    const id = await newProduct(http, auth);
    const res = await http
      .post(`/api/v1/products/${id}/listings?probe=true`)
      .set(auth)
      .send({ url: URL_A });
    expect(res.status).toBe(201);
    expect(res.body.probe).toMatchObject({
      outcome: 'ok',
      result: { priceCents: 123_400 },
    });
    const product = await http.get(`/api/v1/products/${id}`).set(auth);
    expect(product.body.bestEffectivePriceCents).toBe(123_400);
    expect(product.body.listings[0].lastObservation.priceCents).toBe(123_400);
    const attempts = await http
      .get(`/api/v1/listings/${res.body.id}/attempts`)
      .set(auth);
    expect(attempts.body.items).toHaveLength(1);
  });

  it('REQ-API-011 a probe feeds the rules like a scheduled check', async () => {
    const { h, http, auth } = await boot({ realAlerts: true });
    h.adapter.script(URL_A, fakeResult({ priceCents: 150_000 }));
    const id = await newProduct(http, auth);
    await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({ type: 'target_price', params: { targetCents: 200_000 } });

    await http
      .post(`/api/v1/products/${id}/listings?probe=true`)
      .set(auth)
      .send({ url: URL_A });

    expect(h.delivery.requests).toHaveLength(1);
  });

  it('a failed probe still creates the listing and reports the outcome', async () => {
    const { h, http, auth } = await boot();
    h.adapter.script(URL_A, new BlockedError('captcha'));
    const id = await newProduct(http, auth);
    const res = await http
      .post(`/api/v1/products/${id}/listings?probe=true`)
      .set(auth)
      .send({ url: URL_A });
    expect(res.status).toBe(201);
    expect(res.body.probe.outcome).toBe('blocked');
  });

  it('PATCH listing to active resets failures and schedules a check now', async () => {
    const { h, http, auth } = await boot();
    const listingId = await h.addListing(URL_A, {
      status: 'failing',
      consecutiveFailures: 7,
      nextCheckAt: '2030-01-01T00:00:00.000Z',
    });
    const res = await http
      .patch(`/api/v1/listings/${listingId}`)
      .set(auth)
      .send({ status: 'active' });
    expect(res.body).toMatchObject({
      status: 'active',
      consecutiveFailures: 0,
      nextCheckAt: h.clock.now().toISOString(),
    });
    const bad = await http
      .patch(`/api/v1/listings/${listingId}`)
      .set(auth)
      .send({ status: 'failing' });
    expect(bad.status).toBe(400);
  });

  it('changing the interval reschedules the listing now', async () => {
    const { h, http, auth } = await boot();
    const listingId = await h.addListing(URL_A, {
      nextCheckAt: '2030-01-01T00:00:00.000Z',
    });
    const res = await http
      .patch(`/api/v1/listings/${listingId}`)
      .set(auth)
      .send({ checkIntervalMinutes: 5 });
    expect(res.body.nextCheckAt).toBe(h.clock.now().toISOString());
  });

  it('POST /listings/:id/check forces next_check_at = now', async () => {
    const { h, http, auth } = await boot();
    const listingId = await h.addListing(URL_A, {
      nextCheckAt: '2030-01-01T00:00:00.000Z',
    });
    const res = await http
      .post(`/api/v1/listings/${listingId}/check`)
      .set(auth);
    expect(res.body.nextCheckAt).toBe(h.clock.now().toISOString());
  });

  it('REQ-API-004 paginates with limit and cursor, and caps the limit', async () => {
    const { http, auth } = await boot();
    for (const name of ['a', 'b', 'c']) await newProduct(http, auth, name);
    const first = await http.get('/api/v1/products?limit=2').set(auth);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBe(first.body.items[1].id);
    const second = await http
      .get(`/api/v1/products?limit=2&cursor=${first.body.nextCursor}`)
      .set(auth);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect(
      (await http.get('/api/v1/products?limit=501').set(auth)).status,
    ).toBe(400);
  });

  it('lists best price, best listing and lowest ever from in-stock observations only', async () => {
    const { h, http, auth } = await boot();
    h.adapter
      .script('https://fake.test/a', fakeResult({ priceCents: 200_000 }))
      .script(
        'https://fake.test/b',
        fakeResult({ priceCents: 150_000, pixPriceCents: 140_000 }),
      )
      .script(
        'https://fake.test/c',
        fakeResult({ priceCents: 10_000, inStock: false }),
      );
    const id = await newProduct(http, auth);
    const ids: string[] = [];
    for (const path of ['a', 'b', 'c']) {
      const res = await http
        .post(`/api/v1/products/${id}/listings?probe=true`)
        .set(auth)
        .send({ url: `https://fake.test/${path}` });
      ids.push(res.body.id);
    }
    const list = await http.get('/api/v1/products').set(auth);
    expect(list.body.items[0]).toMatchObject({
      bestEffectivePriceCents: 140_000,
      bestListingId: ids[1],
      lowestEverCents: 140_000,
    });
  });

  it('history returns min, max and last effective price per listing and day', async () => {
    const { h, http, auth } = await boot();
    const listingId = await h.addListing(URL_A);
    const productId = (await http.get('/api/v1/products').set(auth)).body
      .items[0].id;
    const { observations } = await import('../../src/db/schema.js');
    const rows = [
      ['2026-01-01T10:00:00.000Z', 100],
      ['2026-01-01T14:00:00.000Z', 80],
      ['2026-01-01T18:00:00.000Z', 90],
      ['2026-01-02T10:00:00.000Z', 70],
    ] as const;
    for (const [i, [at, cents]] of rows.entries()) {
      await h.handle.db.insert(observations).values({
        id: `O${i}`,
        listingId,
        observedAt: at,
        priceCents: cents,
        effectivePriceCents: cents,
        inStock: true,
        strategy: 'api',
      });
    }
    const res = await http
      .get(`/api/v1/products/${productId}/history?bucket=day`)
      .set(auth);
    expect(res.body.items).toEqual([
      {
        listingId,
        day: '2026-01-01',
        minEffectivePriceCents: 80,
        maxEffectivePriceCents: 100,
        lastEffectivePriceCents: 90,
      },
      {
        listingId,
        day: '2026-01-02',
        minEffectivePriceCents: 70,
        maxEffectivePriceCents: 70,
        lastEffectivePriceCents: 70,
      },
    ]);
    const obs = await http
      .get(`/api/v1/listings/${listingId}/observations?limit=2`)
      .set(auth);
    expect(obs.body.items.map((o: { id: string }) => o.id)).toEqual([
      'O3',
      'O2',
    ]);
    expect(obs.body.nextCursor).toBe('O2');
  });

  it('PATCH archives a product; DELETE needs ?confirm=true and cascades', async () => {
    const { h, http, auth } = await boot();
    const id = await newProduct(http, auth);
    const archived = await http
      .patch(`/api/v1/products/${id}`)
      .set(auth)
      .send({ archived: true });
    expect(archived.body.archivedAt).toBe(h.clock.now().toISOString());
    const unarchived = await http
      .patch(`/api/v1/products/${id}`)
      .set(auth)
      .send({ archived: false });
    expect(unarchived.body.archivedAt).toBeNull();

    h.adapter.script(URL_A, fakeResult());
    await http
      .post(`/api/v1/products/${id}/listings?probe=true`)
      .set(auth)
      .send({ url: URL_A });
    await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({ type: 'target_price', params: { targetCents: 1 } });

    const refused = await http.delete(`/api/v1/products/${id}`).set(auth);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('confirmation_required');
    const done = await http
      .delete(`/api/v1/products/${id}?confirm=true`)
      .set(auth);
    expect(done.status).toBe(204);
    expect((await http.get(`/api/v1/products/${id}`).set(auth)).status).toBe(
      404,
    );
    const remaining = await h.handle.client.execute(
      'select (select count(*) from listings) l, (select count(*) from observations) o, (select count(*) from rules) r, (select count(*) from fetch_attempts) a',
    );
    expect(Object.values(remaining.rows[0] as object)).toEqual([0, 0, 0, 0]);
  });

  it('DELETE listing removes its observations', async () => {
    const { h, http, auth } = await boot();
    h.adapter.script(URL_A, fakeResult());
    const id = await newProduct(http, auth);
    const created = await http
      .post(`/api/v1/products/${id}/listings?probe=true`)
      .set(auth)
      .send({ url: URL_A });
    const res = await http
      .delete(`/api/v1/listings/${created.body.id}`)
      .set(auth);
    expect(res.status).toBe(204);
    const count = await h.handle.client.execute(
      'select count(*) c from observations',
    );
    expect(count.rows[0]?.c).toBe(0);
  });
});

describe('rules', () => {
  it('REQ-ALR-002 validates params per type (422)', async () => {
    const { http, auth } = await boot();
    const id = await newProduct(http, auth);
    const res = await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({ type: 'target_price', params: { targetCents: -5 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_params');
    const unknownType = await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({ type: 'percent_drop', params: {} });
    expect(unknownType.status).toBe(400);
  });

  it('REQ-NOT-002 an unknown channel is 422', async () => {
    const { http, auth } = await boot();
    const id = await newProduct(http, auth);
    const res = await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({
        type: 'back_in_stock',
        params: {},
        channels: ['phone', 'ghost'],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.details.unknown).toEqual(['ghost']);
  });

  it('creates, lists, edits (params re-arm the rule) and deletes', async () => {
    const { h, http, auth } = await boot();
    const id = await newProduct(http, auth);
    const created = await http
      .post(`/api/v1/products/${id}/rules`)
      .set(auth)
      .send({
        type: 'target_price',
        params: { targetCents: 200_000 },
        channels: ['PHONE'],
        cooldownMinutes: 60,
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      type: 'target_price',
      channels: ['phone'],
      enabled: true,
      cooldownMinutes: 60,
    });
    const ruleId = created.body.id as string;
    await h.handle.client.execute({
      sql: 'update rules set state = ? where id = ?',
      args: [JSON.stringify({ units: { x: { phase: 'triggered' } } }), ruleId],
    });

    const toggled = await http
      .patch(`/api/v1/rules/${ruleId}`)
      .set(auth)
      .send({ enabled: false });
    expect(toggled.body.enabled).toBe(false);
    expect(await h.ruleState(ruleId)).not.toBeNull();

    const reparam = await http
      .patch(`/api/v1/rules/${ruleId}`)
      .set(auth)
      .send({ params: { targetCents: 150_000 } });
    expect(reparam.body.params).toEqual({ targetCents: 150_000 });
    expect(await h.ruleState(ruleId)).toBeNull();

    expect(
      (
        await http
          .patch(`/api/v1/rules/${ruleId}`)
          .set(auth)
          .send({ type: 'new_low' })
      ).status,
    ).toBe(400);

    const list = await http.get(`/api/v1/products/${id}/rules`).set(auth);
    expect(list.body.items).toHaveLength(1);
    expect(
      (await http.delete(`/api/v1/rules/${ruleId}`).set(auth)).status,
    ).toBe(204);
    expect(
      (await http.get(`/api/v1/products/${id}/rules`).set(auth)).body.items,
    ).toHaveLength(0);
  });
});

describe('adapters, probe, channels, notifications, runs', () => {
  it('lists adapters', async () => {
    const { http, auth } = await boot();
    const res = await http.get('/api/v1/adapters').set(auth);
    expect(res.body.items).toEqual([
      {
        id: 'fake',
        name: 'Fake store',
        domains: ['fake.test'],
        strategies: ['api'],
        browserAvailable: false,
      },
    ]);
  });

  it('POST /probe extracts without persisting', async () => {
    const { h, http, auth } = await boot();
    h.adapter.script(URL_A, fakeResult({ priceCents: 5_000 }));
    const res = await http.post('/api/v1/probe').set(auth).send({ url: URL_A });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      adapter: 'fake',
      outcome: 'ok',
      result: { priceCents: 5_000 },
    });
    const count = await h.handle.client.execute(
      'select (select count(*) from observations) o, (select count(*) from fetch_attempts) a, (select count(*) from listings) l',
    );
    expect(Object.values(count.rows[0] as object)).toEqual([0, 0, 0]);
    expect(
      (
        await http
          .post('/api/v1/probe')
          .set(auth)
          .send({ url: 'https://x.example/' })
      ).status,
    ).toBe(422);
  });

  it('GET /channels masks secrets', async () => {
    const { http, auth } = await boot();
    const res = await http.get('/api/v1/channels').set(auth);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      name: 'phone',
      type: 'telegram',
    });
    expect(JSON.stringify(res.body)).not.toContain(BOT);
  });

  it('POST /channels/:name/test sends system.test and records it', async () => {
    const { h, http, auth, calls } = await boot();
    const ok = await http.post('/api/v1/channels/phone/test').set(auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ channel: 'phone', ok: true });
    expect(calls).toHaveLength(1);
    const rows = await h.handle.db.select().from(notifications);
    expect(rows).toMatchObject([{ kind: 'test', status: 'sent' }]);
    expect(
      (await http.post('/api/v1/channels/ghost/test').set(auth)).status,
    ).toBe(404);
  });

  it('a failing channel test reports the error without leaking the token', async () => {
    const { http, auth } = await boot({ telegramStatus: 401 });
    const res = await http.post('/api/v1/channels/phone/test').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(BOT);
    const history = await http
      .get('/api/v1/notifications?status=failed&channel=phone')
      .set(auth);
    expect(history.body.items).toHaveLength(1);
    expect(JSON.stringify(history.body)).not.toContain(BOT);
  });

  it('REQ-RUN-004 POST /run runs a cycle and GET /runs lists it', async () => {
    const { h, http, auth } = await boot();
    h.adapter.script(URL_A, fakeResult());
    await h.addListing(URL_A);
    const res = await http.post('/api/v1/run').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'completed',
      trigger: 'api',
      listingsChecked: 1,
      successes: 1,
    });
    const runs = await http.get('/api/v1/runs').set(auth);
    expect(runs.body.items).toHaveLength(1);
    expect(runs.body.items[0].id).toBe(res.body.runId);
  });

  it('REQ-RUN-004 POST /run answers 409 while another cycle holds the lock', async () => {
    const { h, http, auth } = await boot();
    await h.locks.acquire('someone-else', h.clock.now(), 10 * MIN);
    const res = await http.post('/api/v1/run').set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('run_in_progress');
  });
});
