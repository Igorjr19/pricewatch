import { describe, expect, it } from 'vitest';
import {
  FakeAdapter,
  fakeResult,
} from '../../src/monitor/adapters/fake.adapter.js';
import {
  BlockedError,
  FetchTimeoutError,
  HttpError,
  NotFoundError,
  ParseError,
} from '../../src/monitor/adapters/types.js';
import { CollectorService } from '../../src/monitor/collector.service.js';
import type { PageFetcher } from '../../src/monitor/ports.js';
import { FakeClock } from '../support/fakes.js';

const url = new URL('https://fake.test/p');

function page(status: number, html = '<html/>'): PageFetcher {
  return { fetch: async () => ({ status, html, finalUrl: url }) };
}

function collector(fetcher: PageFetcher, browser = 'off') {
  return new CollectorService(new FakeClock(), fetcher, { browser });
}

describe('REQ-FET-005 blocks', () => {
  it.each([403, 429])('HTTP %s is blocked', async (status) => {
    const adapter = new FakeAdapter({ strategies: ['http'] });
    const result = await collector(page(status)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'blocked' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('an adapter that detects a challenge page reports blocked', async () => {
    const adapter = new FakeAdapter({ strategies: ['http'] }).script(
      url.toString(),
      new BlockedError('captcha'),
    );
    const result = await collector(page(200)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'blocked', reason: 'captcha' });
  });
});

describe('REQ-FET-006 next strategy after a block', () => {
  it('tries the next strategy when http is blocked', async () => {
    const adapter = new FakeAdapter({ strategies: ['http', 'api'] }).script(
      url.toString(),
      new BlockedError('challenge'),
      fakeResult({ priceCents: 5 }),
    );
    const result = await collector(page(200)).collect(adapter, url);

    expect(result).toMatchObject({ outcome: 'ok', strategy: 'api' });
    expect(result.attempts.map((a) => [a.strategy, a.outcome])).toEqual([
      ['http', 'blocked'],
      ['api', 'ok'],
    ]);
  });

  it('does not try another strategy after a non-block failure', async () => {
    const adapter = new FakeAdapter({ strategies: ['http', 'api'] }).script(
      url.toString(),
      new ParseError('no price'),
    );
    const result = await collector(page(200)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'parse_error' });
    expect(result.attempts).toHaveLength(1);
  });
});

describe('REQ-FET-003 browser off', () => {
  it('marks a browser-only adapter strategy_unavailable without calling it', async () => {
    const adapter = new FakeAdapter({ strategies: ['browser'] });
    const result = await collector(page(200)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'strategy_unavailable' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('a blocked http followed by an unavailable browser stays blocked (a failure)', async () => {
    const adapter = new FakeAdapter({ strategies: ['http', 'browser'] });
    const result = await collector(page(403)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'blocked' });
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      'blocked',
      'strategy_unavailable',
    ]);
  });

  it('honors an adapter that declares a strategy unavailable (api without credentials)', async () => {
    const adapter = new FakeAdapter({ strategies: ['api', 'http'] });
    adapter.isStrategyAvailable = (s) => s !== 'api';
    adapter.script(url.toString(), fakeResult());
    const result = await collector(page(200)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'ok', strategy: 'http' });
  });
});

describe('REQ-CYC-006 outcomes', () => {
  it.each([
    [new NotFoundError('gone'), 'not_found'],
    [new ParseError('bad'), 'parse_error'],
    [new FetchTimeoutError('slow'), 'timeout'],
    [new HttpError('reset'), 'http_error'],
    [new Error('surprise'), 'parse_error'],
  ])('maps %s to %s', async (error, outcome) => {
    const adapter = new FakeAdapter({ strategies: ['api'] }).script(
      url.toString(),
      error,
    );
    const result = await collector(page(200)).collect(adapter, url);
    expect(result.outcome).toBe(outcome);
  });

  it('HTTP 5xx is http_error and records the status', async () => {
    const adapter = new FakeAdapter({ strategies: ['http'] });
    const result = await collector(page(503)).collect(adapter, url);
    expect(result).toMatchObject({ outcome: 'http_error' });
    expect(result.attempts[0]?.httpStatus).toBe(503);
  });

  it('passes html, status and final URL to the adapter, and truncates long error messages', async () => {
    const adapter = new FakeAdapter({ strategies: ['http'] }).script(
      url.toString(),
      new ParseError('x'.repeat(2000)),
    );
    const result = await collector(page(404, '<p>nf</p>')).collect(
      adapter,
      url,
    );
    expect(adapter.calls[0]).toMatchObject({
      strategy: 'http',
      html: '<p>nf</p>',
      httpStatus: 404,
    });
    expect(result.attempts[0]?.errorMessage).toHaveLength(1000);
  });
});
