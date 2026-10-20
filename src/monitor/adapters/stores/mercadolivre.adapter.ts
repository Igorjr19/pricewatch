import { parseBRL, stripTracking } from '../helpers.js';
import {
  BlockedError,
  type ExtractContext,
  type ExtractResult,
  NotFoundError,
  ParseError,
  type StoreAdapter,
  type Strategy,
} from '../types.js';

type Json = Record<string, unknown> | undefined;

/** Search and campaign parameters that do not identify the product. `wid` and `pdp_filters` do. */
const ML_TRACKING =
  /^(matt_.*|searchVariation|position|search_layout|type|tracking_id|reco_.*|sid|c_id|c_uid|polycard_client|backend_model|source)$/i;

/**
 * Reads `_n.ctx.r={...};` from the page state. The assignment is followed by other statements,
 * so the object end is found by brace matching that respects strings.
 */
export function extractNordicState(html: string): Json {
  const marker = '_n.ctx.r=';
  const start = html.indexOf(marker);
  if (start === -1) return undefined;
  const from = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(from, i + 1)) as Json;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' ? (value as Json) : undefined;
const at = (root: unknown, ...path: (string | number)[]): unknown => {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
};

/**
 * Mercado Livre via `http`. Source: the page state (spec 14, A1). JSON-LD is not used: on catalog pages
 * its variant price matches neither the cash nor the Pix price.
 */
export class MercadoLivreAdapter implements StoreAdapter {
  readonly id = 'mercadolivre';
  readonly displayName = 'Mercado Livre';
  readonly domains = [
    'www.mercadolivre.com.br',
    'mercadolivre.com.br',
    'produto.mercadolivre.com.br',
  ];
  readonly strategies: Strategy[] = ['http'];

  normalizeUrl(url: URL): URL {
    const clean = stripTracking(url);
    for (const key of [...clean.searchParams.keys()]) {
      if (ML_TRACKING.test(key)) clean.searchParams.delete(key);
    }
    return clean;
  }

  async extract(ctx: ExtractContext): Promise<ExtractResult> {
    const html = ctx.html ?? '';
    // REQ-FET-005: the challenge answers HTTP 200 after a redirect, so the URL and body decide, not the status.
    if (
      ctx.finalUrl?.pathname.startsWith('/gz/account-verification') ||
      html.includes('negative_traffic')
    ) {
      throw new BlockedError('account verification challenge');
    }

    const initialState = at(
      extractNordicState(html),
      'appProps',
      'pageProps',
      'initialState',
    );
    const components = obj(at(initialState, 'components'));
    if (!components) {
      if (ctx.httpStatus === 404) throw new NotFoundError('listing not found');
      throw new ParseError('no page state found');
    }

    const priceBlock = obj(components.price);
    const noStock = at(components, 'no_stock_status', 'state') === 'VISIBLE';
    const visible = priceBlock?.state === 'VISIBLE';
    const current = at(priceBlock, 'price', 'value');
    if (!priceBlock || (!visible && !noStock)) {
      throw new ParseError('neither price nor stock state found');
    }

    // The bookmark carries the item id; hidden on out-of-stock pages, where the page id is the item.
    const externalId =
      at(components, 'bookmark', 'item_id') ?? at(initialState, 'id');
    const title = at(components, 'header', 'title');
    const seller = at(
      components,
      'seller_summary',
      'seller_link',
      'label',
      'text',
    );
    const base = {
      title: typeof title === 'string' ? title : null,
      seller: typeof seller === 'string' ? seller : null,
      externalId: typeof externalId === 'string' ? externalId : null,
    };

    // Out of stock: the page keeps no usable price (REQ-ADP-005).
    if (noStock || !visible || typeof current !== 'number' || current <= 0) {
      return {
        ...base,
        priceCents: null,
        pixPriceCents: null,
        installments: null,
        inStock: false,
      };
    }

    const subtitle = obj(at(priceBlock, 'subtitles', 0));
    const total = at(subtitle, 'values', 'total_price', 'value');
    const installmentValue = at(
      subtitle,
      'values',
      'price_installments',
      'value',
    );
    const installmentText = at(subtitle, 'text');
    const count =
      typeof installmentText === 'string'
        ? Number(/(\d+)x/.exec(installmentText)?.[1])
        : Number.NaN;

    // The current price already includes the Pix discount when the breakdown has a Pix line (REQ-ADP-006).
    const items = at(priceBlock, 'price_breakdown', 'bottomsheet', 'items');
    const pixLine = Array.isArray(items)
      ? items.find(
          (item) =>
            typeof at(item, 'title', 'label', 'text') === 'string' &&
            /pix/i.test(at(item, 'title', 'label', 'text') as string),
        )
      : undefined;
    const pixDiscount = parseBRL(
      at(pixLine, 'value', 'label', 'values', 'price', 'value') as number,
    );

    const currentCents = parseBRL(current) as number;
    let priceCents = parseBRL(typeof total === 'number' ? total : current);
    let pixPriceCents: number | null = null;
    if (pixLine) {
      pixPriceCents = currentCents;
      if (typeof total !== 'number' && pixDiscount !== null) {
        priceCents = currentCents + pixDiscount;
      }
      if (priceCents === null || pixPriceCents >= priceCents) {
        pixPriceCents = null;
      }
    }

    return {
      ...base,
      priceCents,
      pixPriceCents,
      installments:
        Number.isFinite(count) && typeof installmentValue === 'number'
          ? { count, priceCents: parseBRL(installmentValue) as number }
          : null,
      inStock: true,
    };
  }
}
