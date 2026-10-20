import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractEmbeddedJson,
  parseBRL,
  stripTracking,
} from '../../src/monitor/adapters/helpers.js';
import { KabumAdapter } from '../../src/monitor/adapters/stores/kabum.adapter.js';
import {
  BlockedError,
  NotFoundError,
  ParseError,
} from '../../src/monitor/adapters/types.js';

describe('REQ-ADP-003 parseBRL', () => {
  it.each([
    ['R$ 1.234,56', 123_456],
    ['1234,56', 123_456],
    ['1.234', 123_400],
    ['R$ 2.699,00', 269_900],
    ['99,9', 9_990],
    ['12', 1_200],
    [1234.56, 123_456],
    [6443.33, 644_333],
    [2429.1, 242_910],
    [0, 0],
  ])('%j → %j cents', (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it.each(['', 'abc', 'R$', '-5', null, undefined, Number.NaN])(
    'rejects %j',
    (input) => {
      expect(parseBRL(input as never)).toBeNull();
    },
  );
});

describe('REQ-ADP-008 helpers', () => {
  it('extractEmbeddedJson reads a script by id or by regex, and tolerates garbage', () => {
    const html =
      '<script id="state" type="application/json">{"a":1}</script><script>var x = {"b":2};</script>';
    expect(extractEmbeddedJson(html, 'state')).toEqual({ a: 1 });
    expect(extractEmbeddedJson(html, /var x = (\{.*?\});/)).toEqual({ b: 2 });
    expect(extractEmbeddedJson(html, 'missing')).toBeNull();
    expect(
      extractEmbeddedJson('<script id="s">{oops</script>', 's'),
    ).toBeNull();
  });
});

describe('REQ-ADP-002 tracking parameters', () => {
  it('stripTracking drops tracking keys and the hash, keeps the rest', () => {
    const url = stripTracking(
      new URL('https://x.test/p?utm_source=a&ref=b&gclid=c&id=7#frag'),
    );
    expect(url.toString()).toBe('https://x.test/p?id=7');
  });
});

describe('kabum adapter', () => {
  const adapter = new KabumAdapter();
  const dir = resolve('test/fixtures/kabum');
  const manifest = JSON.parse(
    readFileSync(resolve(dir, 'manifest.json'), 'utf8'),
  ) as {
    fixtures: {
      file: string;
      url: string;
      httpStatus?: number;
      expected?: Record<string, unknown>;
      expectedError?: string;
    }[];
  };
  const errors = { BlockedError, NotFoundError, ParseError } as const;

  it('REQ-ADP-007 has in-stock, out-of-stock and blocked fixtures', () => {
    const kinds = manifest.fixtures.map((f) =>
      f.expected?.inStock === true
        ? 'in'
        : f.expected?.inStock === false
          ? 'out'
          : f.expectedError,
    );
    expect(kinds).toEqual(
      expect.arrayContaining(['in', 'out', 'BlockedError', 'NotFoundError']),
    );
  });

  describe.each(manifest.fixtures)('REQ-ADP-007 fixture $file', (fixture) => {
    it('matches the manifest', async () => {
      const html = readFileSync(resolve(dir, fixture.file), 'utf8');
      const run = adapter.extract({
        strategy: 'http',
        url: new URL(fixture.url),
        html,
        httpStatus: fixture.httpStatus ?? 200,
      });
      if (fixture.expectedError) {
        await expect(run).rejects.toBeInstanceOf(
          errors[fixture.expectedError as keyof typeof errors],
        );
      } else {
        await expect(run).resolves.toMatchObject(fixture.expected ?? {});
      }
    });
  });

  it('REQ-ADP-002 two URLs for the same product normalize identically', () => {
    const a = adapter.normalizeUrl(
      new URL('https://kabum.com.br/produto/703054/galaxy-s25?utm_source=x'),
    );
    const b = adapter.normalizeUrl(
      new URL('https://www.kabum.com.br/produto/703054?gclid=1#top'),
    );
    expect(a.toString()).toBe('https://www.kabum.com.br/produto/703054');
    expect(b.toString()).toBe(a.toString());
  });

  const page = (product: unknown) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { product } },
    })}</script>`;
  const extract = (product: unknown) =>
    adapter.extract({
      strategy: 'http',
      url: new URL('https://www.kabum.com.br/produto/1'),
      html: page(product),
      httpStatus: 200,
    });

  it('REQ-ADP-006 sets the Pix price only when it is lower than the list price', async () => {
    const base = { id: 1, available: true, flags: { isAvailable: true } };
    expect(
      (
        await extract({
          ...base,
          prices: { price: 100, priceWithDiscount: 90 },
        })
      ).pixPriceCents,
    ).toBe(9_000);
    expect(
      (
        await extract({
          ...base,
          prices: { price: 100, priceWithDiscount: 100 },
        })
      ).pixPriceCents,
    ).toBeNull();
    expect(
      (await extract({ ...base, prices: { price: 100 } })).pixPriceCents,
    ).toBeNull();
  });

  it('REQ-ADP-004 a page without a product or a decidable state is a ParseError', async () => {
    await expect(
      adapter.extract({
        strategy: 'http',
        url: new URL('https://www.kabum.com.br/produto/1'),
        html: '<html>nothing</html>',
        httpStatus: 200,
      }),
    ).rejects.toBeInstanceOf(ParseError);
    await expect(extract({ id: 1, prices: {} })).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('REQ-ADP-005 an unavailable product keeps a null-safe result', async () => {
    const result = await extract({
      id: 1,
      available: false,
      flags: { isAvailable: false },
      prices: {},
    });
    expect(result).toMatchObject({ inStock: false, priceCents: null });
  });

  it('availability needs both flags', async () => {
    const result = await extract({
      id: 1,
      available: true,
      flags: { isAvailable: false },
      prices: { price: 10 },
    });
    expect(result.inStock).toBe(false);
  });
});
