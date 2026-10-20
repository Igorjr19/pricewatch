import { describe, expect, it } from 'vitest';
import { formatBRL } from '../../src/alerts/format.js';
import { parseRuleParams } from '../../src/alerts/params.js';

describe('REQ-ALR-020 BRL formatting', () => {
  it.each([
    [195_000, 'R$ 1.950,00'],
    [5, 'R$ 0,05'],
    [100, 'R$ 1,00'],
    [123_456_789, 'R$ 1.234.567,89'],
    [0, 'R$ 0,00'],
    [-2_550, '-R$ 25,50'],
  ])('%s → %s', (cents, text) => {
    expect(formatBRL(cents)).toBe(text);
  });

  it('uses a plain space, not a non-breaking one', () => {
    expect(formatBRL(100)).not.toContain(' ');
  });
});

describe('REQ-ALR-002 params validation', () => {
  it('target_price needs a positive integer targetCents', () => {
    expect(parseRuleParams('target_price', { targetCents: 200_000 }).ok).toBe(
      true,
    );
    for (const bad of [
      {},
      { targetCents: 0 },
      { targetCents: -1 },
      { targetCents: 1.5 },
      { targetCents: '1' },
    ]) {
      expect(parseRuleParams('target_price', bad).ok).toBe(false);
    }
  });

  it('new_low defaults minHistoryDays to 7 and bounds it to [0, 365]', () => {
    expect(parseRuleParams('new_low', {})).toEqual({
      ok: true,
      params: { minHistoryDays: 7 },
    });
    expect(parseRuleParams('new_low', { minHistoryDays: 0 }).ok).toBe(true);
    expect(parseRuleParams('new_low', { minHistoryDays: 365 }).ok).toBe(true);
    expect(parseRuleParams('new_low', { minHistoryDays: 366 }).ok).toBe(false);
    expect(parseRuleParams('new_low', { minHistoryDays: -1 }).ok).toBe(false);
  });

  it('back_in_stock takes no params', () => {
    expect(parseRuleParams('back_in_stock', {}).ok).toBe(true);
    expect(parseRuleParams('back_in_stock', { extra: 1 }).ok).toBe(false);
  });
});
