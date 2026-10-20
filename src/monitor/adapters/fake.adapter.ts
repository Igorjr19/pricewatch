import type {
  ExtractContext,
  ExtractResult,
  StoreAdapter,
  Strategy,
} from './types.js';

export type ScriptStep = ExtractResult | Error;

/**
 * Scripted adapter for tests and offline development. Each URL has a queue of steps:
 * results are returned, errors are thrown. The last step repeats once the queue is drained.
 */
export class FakeAdapter implements StoreAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly domains: string[];
  strategies: Strategy[];
  readonly calls: ExtractContext[] = [];
  isStrategyAvailable?: (strategy: Strategy) => boolean;
  private readonly scripts = new Map<string, ScriptStep[]>();

  constructor(
    options: { id?: string; domains?: string[]; strategies?: Strategy[] } = {},
  ) {
    this.id = options.id ?? 'fake';
    this.displayName = 'Fake store';
    this.domains = options.domains ?? ['fake.test'];
    this.strategies = options.strategies ?? ['api'];
  }

  script(url: string, ...steps: ScriptStep[]): this {
    this.scripts.set(url, steps);
    return this;
  }

  normalizeUrl(url: URL): URL {
    return url;
  }

  async extract(ctx: ExtractContext): Promise<ExtractResult> {
    this.calls.push(ctx);
    const steps = this.scripts.get(ctx.url.toString());
    if (!steps || steps.length === 0)
      throw new Error(`FakeAdapter: no script for ${ctx.url}`);
    const step = (steps.length > 1 ? steps.shift() : steps[0]) as ScriptStep;
    if (step instanceof Error) throw step;
    return step;
  }
}

export function fakeResult(
  overrides: Partial<ExtractResult> = {},
): ExtractResult {
  return {
    priceCents: 100_000,
    pixPriceCents: null,
    installments: null,
    inStock: true,
    title: 'Fake product',
    seller: 'Fake seller',
    externalId: 'FAKE1',
    ...overrides,
  };
}
