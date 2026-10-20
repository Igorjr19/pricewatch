import { extractEmbeddedJson, stripTracking } from '../helpers.js';
import {
  BlockedError,
  type ExtractContext,
  type ExtractResult,
  NotFoundError,
  ParseError,
  type StoreAdapter,
  type Strategy,
} from '../types.js';

const BLOCK_MARKERS = [
  'cf-challenge',
  'Just a moment',
  'Attention Required',
  'Access Denied',
  'captcha',
];

interface KabumProduct {
  id?: number | string;
  title?: string;
  sellerName?: string;
  available?: boolean;
  flags?: { isAvailable?: boolean };
  prices?: { price?: number; priceWithDiscount?: number };
}

const cents = (reais: unknown): number | null =>
  typeof reais === 'number' && Number.isFinite(reais) && reais > 0
    ? Math.round(reais * 100)
    : null;

/**
 * KaBuM! via `http`. Source: `__NEXT_DATA__` → `props.pageProps.product` (spec 14, A6).
 * JSON-LD is deliberately not used: its `offers.price` is the Pix price, not the list price.
 */
export class KabumAdapter implements StoreAdapter {
  readonly id = 'kabum';
  readonly displayName = 'KaBuM!';
  readonly domains = ['www.kabum.com.br', 'kabum.com.br'];
  readonly strategies: Strategy[] = ['http'];

  /** `/produto/<id>[/slug]` → `https://www.kabum.com.br/produto/<id>`; the id is the identity. */
  normalizeUrl(url: URL): URL {
    const clean = stripTracking(url);
    const id = /^\/produto\/(\d+)/.exec(clean.pathname)?.[1];
    if (!id) return clean;
    return new URL(`https://www.kabum.com.br/produto/${id}`);
  }

  async extract(ctx: ExtractContext): Promise<ExtractResult> {
    const html = ctx.html ?? '';
    const data = extractEmbeddedJson(html, '__NEXT_DATA__') as {
      props?: { pageProps?: { product?: KabumProduct } };
    } | null;
    const product = data?.props?.pageProps?.product;

    if (!product) {
      if (ctx.httpStatus === 404) throw new NotFoundError('product not found');
      if (BLOCK_MARKERS.some((marker) => html.includes(marker))) {
        throw new BlockedError('anti-bot challenge page');
      }
      throw new ParseError('no product in __NEXT_DATA__');
    }

    const priceCents = cents(product.prices?.price);
    const discounted = cents(product.prices?.priceWithDiscount);
    const inStock =
      product.available === true && product.flags?.isAvailable === true;
    if (priceCents === null && !inStock && product.available === undefined) {
      throw new ParseError('product has neither price nor stock');
    }

    return {
      priceCents,
      // REQ-ADP-006: only when it is a distinct, lower price.
      pixPriceCents:
        priceCents !== null && discounted !== null && discounted < priceCents
          ? discounted
          : null,
      installments: null,
      inStock,
      title: product.title ?? null,
      seller: product.sellerName ?? null,
      externalId: product.id === undefined ? null : String(product.id),
    };
  }
}
