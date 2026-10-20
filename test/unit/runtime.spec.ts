import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchAttempts, notifications } from '../../src/db/schema.js';
import { FakeAdapter } from '../../src/monitor/adapters/fake.adapter.js';
import { KabumAdapter } from '../../src/monitor/adapters/stores/kabum.adapter.js';
import {
  FetchTimeoutError,
  HttpError,
} from '../../src/monitor/adapters/types.js';
import { FixturesFetcher } from '../../src/monitor/fixtures.fetcher.js';
import { HttpFetcher } from '../../src/monitor/http.fetcher.js';
import { Ticker } from '../../src/monitor/ticker.js';
import { makeHarness } from '../support/harness.js';

const adapter = new FakeAdapter({ domains: ['fake.test', 'www.fake.test'] });

function fetcherFor(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = new HttpFetcher({
    userAgent: 'UA/1',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  });
  return { fetcher, calls };
}

describe('REQ-FET-001 HttpFetcher', () => {
  it('sends the configured headers and returns status, body and final URL', async () => {
    const { fetcher, calls } = fetcherFor(() => new Response('<p>hi</p>'));
    const page = await fetcher.fetch(new URL('https://fake.test/a'), adapter);
    expect(page).toMatchObject({ status: 200, html: '<p>hi</p>' });
    expect(page.finalUrl.toString()).toBe('https://fake.test/a');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('UA/1');
    expect(headers['accept-language']).toBe('pt-BR,pt;q=0.9');
    expect(headers['accept-encoding']).toBe('gzip, br');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows redirects within the adapter domains and reports the final URL', async () => {
    const { fetcher } = fetcherFor((url) =>
      url === 'https://fake.test/a'
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://www.fake.test/b' },
          })
        : new Response('final'),
    );
    const page = await fetcher.fetch(new URL('https://fake.test/a'), adapter);
    expect(page.html).toBe('final');
    expect(page.finalUrl.toString()).toBe('https://www.fake.test/b');
  });

  it('a redirect to another domain is an http_error', async () => {
    const { fetcher } = fetcherFor(
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://evil.example/x' },
        }),
    );
    await expect(
      fetcher.fetch(new URL('https://fake.test/a'), adapter),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('gives up after too many redirects', async () => {
    const { fetcher } = fetcherFor(
      () => new Response(null, { status: 302, headers: { location: '/loop' } }),
    );
    await expect(
      fetcher.fetch(new URL('https://fake.test/a'), adapter),
    ).rejects.toThrow('too many redirects');
  });

  it('returns 4xx/5xx instead of throwing', async () => {
    const { fetcher } = fetcherFor(() => new Response('no', { status: 403 }));
    const page = await fetcher.fetch(new URL('https://fake.test/a'), adapter);
    expect(page.status).toBe(403);
  });

  it('maps a timeout and a network error to typed errors', async () => {
    const timeout = fetcherFor(() => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    }).fetcher;
    await expect(
      timeout.fetch(new URL('https://fake.test/a'), adapter),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    const network = fetcherFor(() => {
      throw Object.assign(new Error('fetch failed'), {
        cause: { code: 'ECONNRESET' },
      });
    }).fetcher;
    await expect(
      network.fetch(new URL('https://fake.test/a'), adapter),
    ).rejects.toThrow('network error: ECONNRESET');
  });
});

describe('REQ-RUN-005 Ticker', () => {
  it('never starts a second cycle while one is running in this process', async () => {
    const h = await makeHarness();
    try {
      let release: () => void = () => {};
      let started = 0;
      const cycle = {
        run: () => {
          started++;
          return new Promise((resolve) => {
            release = () => resolve({ lockBusy: true });
          });
        },
      };
      const ticker = new Ticker(cycle as never, 1000);
      const first = ticker.tick();
      expect(await ticker.tick()).toBe(false);
      expect(started).toBe(1);
      release();
      expect(await first).toBe(true);
      const second = ticker.tick();
      release();
      await second;
      expect(started).toBe(2);
    } finally {
      h.handle.close();
    }
  });

  it('reports a cycle error without stopping the ticker, and stop() waits and aborts', async () => {
    const errors: unknown[] = [];
    let signal: AbortSignal | undefined;
    const cycle = {
      run: async (_t: string, s: AbortSignal) => {
        signal = s;
        throw new Error('boom');
      },
    };
    const ticker = new Ticker(cycle as never, 1000, (e) => errors.push(e));
    await ticker.tick();
    expect(errors).toHaveLength(1);
    await ticker.stop();
    expect(signal?.aborted).toBe(true);
  });
});

describe('REQ-DB-006 retention failure', () => {
  it('a failing prune does not turn a completed cycle into a failed one', async () => {
    const h = await makeHarness({ config: { retentionMs: 1000 } });
    try {
      await h.handle.client.execute('drop table fetch_attempts');
      const result = await h.cycle.run('cli');
      expect(result.lockBusy).toBe(false);
      if (!result.lockBusy) expect(result.summary.status).toBe('completed');
    } finally {
      h.handle.close();
    }
  });
});

describe('REQ-DB-006 retention', () => {
  it('prunes old attempts and notifications at the end of a cycle, never observations', async () => {
    const h = await makeHarness({ config: { retentionMs: 90 * 86_400_000 } });
    try {
      const old = new Date(h.clock.now().getTime() - 91 * 86_400_000);
      const recent = new Date(h.clock.now().getTime() - 89 * 86_400_000);
      const listingId = await h.addListing('https://fake.test/a', {
        nextCheckAt: '2099-01-01T00:00:00.000Z',
      });
      for (const [id, at] of [
        ['A-old', old],
        ['A-new', recent],
      ] as const) {
        await h.handle.db.insert(fetchAttempts).values({
          id,
          listingId,
          startedAt: at.toISOString(),
          strategy: 'api',
          outcome: 'ok',
        });
      }
      for (const [id, at] of [
        ['N-old', old],
        ['N-new', recent],
      ] as const) {
        await h.handle.db.insert(notifications).values({
          id,
          channel: 'c',
          kind: 'test',
          status: 'sent',
          createdAt: at.toISOString(),
        });
      }
      await h.handle.client.execute({
        sql: "insert into observations (id, listing_id, observed_at, in_stock, strategy) values ('O-old', ?, ?, 1, 'api')",
        args: [listingId, old.toISOString()],
      });

      await h.cycle.run('cli');

      const ids = async (table: string) =>
        (
          await h.handle.client.execute(`select id from ${table} order by id`)
        ).rows.map((r) => r.id);
      expect(await ids('fetch_attempts')).toEqual(['A-new']);
      expect(await ids('notifications')).toEqual(['N-new']);
      expect(await ids('observations')).toEqual(['O-old']);
    } finally {
      h.handle.close();
    }
  });
});

describe('REQ-DX-009 FixturesFetcher', () => {
  const kabum = new KabumAdapter();
  const fetcher = new FixturesFetcher(resolve('test/fixtures'), (url) =>
    kabum.normalizeUrl(url).toString(),
  );

  it('answers from the manifests, matching on the normalized URL', async () => {
    const page = await fetcher.fetch(
      new URL('https://kabum.com.br/produto/703054/algum-slug?utm_source=x'),
      kabum,
    );
    expect(page.status).toBe(200);
    expect(page.html).toContain('__NEXT_DATA__');
  });

  it('keeps the recorded status and fails for unknown URLs without touching the network', async () => {
    const missing = await fetcher.fetch(
      new URL('https://www.kabum.com.br/produto/99999999'),
      kabum,
    );
    expect(missing.status).toBe(404);
    await expect(
      fetcher.fetch(new URL('https://www.kabum.com.br/produto/2'), kabum),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
