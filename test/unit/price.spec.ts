import { describe, expect, it } from 'vitest';
import { effectivePriceCents } from '../../src/monitor/price.js';

describe('glossary: effective price', () => {
  it.each([
    [100_000, 90_000, 90_000],
    [90_000, 100_000, 90_000],
    [100_000, null, 100_000],
    [null, 90_000, 90_000],
    [null, null, null],
  ])('price=%s pix=%s → %s', (price, pix, expected) => {
    expect(effectivePriceCents(price, pix)).toBe(expected);
  });
});
