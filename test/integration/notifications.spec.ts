import { afterEach, describe, expect, it } from 'vitest';
import type { RuleState } from '../../src/alerts/evaluators/types.js';
import { notifications } from '../../src/db/schema.js';
import { fakeResult } from '../../src/monitor/adapters/fake.adapter.js';
import { BlockedError } from '../../src/monitor/adapters/types.js';
import { NotificationService } from '../../src/notifications/notification.service.js';
import {
  DeliveryError,
  type NotificationEvent,
  type Notifier,
} from '../../src/notifications/types.js';
import { type Harness, HOUR, makeHarness } from '../support/harness.js';

const URL_A = 'https://fake.test/a';

/** Records what it was asked to send; `failWith` makes it throw instead. */
class ScriptedNotifier implements Notifier {
  readonly events: NotificationEvent[] = [];
  attempts = 0;
  failWith: (() => Error) | null = null;
  /** Fail this many times, then succeed. */
  failTimes = 0;

  async send(event: NotificationEvent): Promise<void> {
    this.attempts++;
    if (this.failTimes > 0) {
      this.failTimes--;
      throw this.failWith?.() ?? new DeliveryError('HTTP 503', true);
    }
    if (this.failWith) throw this.failWith();
    this.events.push(event);
  }
}

let harness: Harness | undefined;
afterEach(() => {
  harness?.handle.close();
  harness = undefined;
});

async function setup(
  notifiers: Record<string, Notifier>,
  options: {
    defaultChannels?: string[];
    systemChannels?: string[];
    secrets?: Record<string, string[]>;
    cycle?: Parameters<typeof makeHarness>[0];
  } = {},
) {
  let service: NotificationService | undefined;
  harness = await makeHarness({
    ...options.cycle,
    realAlerts: true,
    buildDelivery: ({ db, clock }) => {
      service = new NotificationService({
        db,
        clock,
        notifiers: new Map(Object.entries(notifiers)),
        secrets: new Map(Object.entries(options.secrets ?? {})),
        defaultChannels: options.defaultChannels,
        systemChannels: options.systemChannels,
      });
      return service;
    },
  });
  return { h: harness, service: service as NotificationService };
}

async function rows(h: Harness) {
  return h.handle.db.select().from(notifications);
}

async function alertCycle(h: Harness, listingId: string, priceCents: number) {
  h.adapter.script(URL_A, fakeResult({ priceCents }));
  await h.makeDue(listingId);
  return h.cycle.run('cli');
}

describe('REQ-NOT-004 independent channels and notification rows', () => {
  it('a failing channel does not block the others, and every delivery leaves a row', async () => {
    const phone = new ScriptedNotifier();
    const mail = new ScriptedNotifier();
    mail.failWith = () => new DeliveryError('HTTP 401', false);
    const { h } = await setup({ phone, mail });
    const listingId = await h.addListing(URL_A);
    await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { channels: ['phone', 'mail'] },
    );

    const result = await alertCycle(h, listingId, 190_000);

    expect(result).toMatchObject({ summary: { notificationsSent: 1 } });
    expect(phone.events).toHaveLength(1);
    const stored = await rows(h);
    expect(stored.map((r) => [r.channel, r.status, r.kind]).sort()).toEqual([
      ['mail', 'failed', 'alert'],
      ['phone', 'sent', 'alert'],
    ]);
    const failed = stored.find((r) => r.channel === 'mail');
    expect(failed?.errorMessage).toBe('HTTP 401');
  });

  it('stores the rule, listing, observation and the exact payload', async () => {
    const phone = new ScriptedNotifier();
    const { h } = await setup({ phone });
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });

    await alertCycle(h, listingId, 190_000);

    const [row] = await rows(h);
    expect(row).toMatchObject({
      ruleId,
      listingId,
      channel: 'phone',
      status: 'sent',
      kind: 'alert',
    });
    expect(row?.observationId).toEqual(expect.any(String));
    expect(row?.payload).toEqual(phone.events[0]);
    expect(row?.errorMessage).toBeNull();
  });
});

describe('channel selection', () => {
  it('uses PW_DEFAULT_CHANNELS when the rule names none, and every channel when unset', async () => {
    const a = new ScriptedNotifier();
    const b = new ScriptedNotifier();
    const c = new ScriptedNotifier();
    const { h } = await setup({ a, b, c }, { defaultChannels: ['a', 'c'] });
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });
    await alertCycle(h, listingId, 190_000);
    expect([a.events.length, b.events.length, c.events.length]).toEqual([
      1, 0, 1,
    ]);
  });

  it('every configured channel receives the alert when no defaults are set', async () => {
    const a = new ScriptedNotifier();
    const b = new ScriptedNotifier();
    const { h } = await setup({ a, b });
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });
    await alertCycle(h, listingId, 190_000);
    expect([a.events.length, b.events.length]).toEqual([1, 1]);
  });

  it('a rule that names a channel which no longer exists records a failed delivery', async () => {
    const a = new ScriptedNotifier();
    const { h } = await setup({ a });
    const listingId = await h.addListing(URL_A);
    await h.addRule(
      'P1',
      'target_price',
      { targetCents: 200_000 },
      { channels: ['ghost'] },
    );
    await alertCycle(h, listingId, 190_000);

    const [row] = await rows(h);
    expect(row).toMatchObject({
      channel: 'ghost',
      status: 'failed',
      errorMessage: 'unknown channel',
    });
  });
});

describe('REQ-NOT-005 retries inside the service', () => {
  it('retries a 5xx after 2 s and records one sent row', async () => {
    const phone = new ScriptedNotifier();
    phone.failTimes = 1;
    const { h } = await setup({ phone });
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });

    await alertCycle(h, listingId, 190_000);

    expect(phone.attempts).toBe(2);
    expect(h.clock.sleeps).toContain(2_000);
    expect((await rows(h)).map((r) => r.status)).toEqual(['sent']);
  });
});

describe('REQ-NOT-006 and REQ-ALR-015: all channels fail', () => {
  it('records every failure, does not advance the rule state, and retries next cycle', async () => {
    const phone = new ScriptedNotifier();
    const mail = new ScriptedNotifier();
    phone.failWith = () => new DeliveryError('HTTP 500', true);
    mail.failWith = () => new DeliveryError('SMTP error: 535', false);
    const { h } = await setup({ phone, mail });
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });

    const first = await alertCycle(h, listingId, 190_000);

    expect(first).toMatchObject({ summary: { notificationsSent: 0 } });
    const state = (await h.ruleState(ruleId)) as RuleState;
    expect(state.units.product).toMatchObject({
      status: 'armed',
      pendingDelivery: true,
    });
    expect((await rows(h)).filter((r) => r.status === 'failed')).toHaveLength(
      2,
    );

    // Channels recover; with no new observation the pending flag forces a retry.
    phone.failWith = null;
    mail.failWith = null;
    h.clock.advance(5 * 60_000);
    const second = await h.cycle.run('cli');

    expect(second).toMatchObject({
      summary: { listingsDue: 0, notificationsSent: 2 },
    });
    const advanced = (await h.ruleState(ruleId)) as RuleState;
    expect(advanced.units.product).toMatchObject({
      status: 'triggered',
      pendingDelivery: false,
    });
    expect(phone.events).toHaveLength(1);
  });

  it('at least one successful channel is enough to advance the state', async () => {
    const phone = new ScriptedNotifier();
    const mail = new ScriptedNotifier();
    mail.failWith = () => new DeliveryError('HTTP 400', false);
    const { h } = await setup({ phone, mail });
    const listingId = await h.addListing(URL_A);
    const ruleId = await h.addRule('P1', 'target_price', {
      targetCents: 200_000,
    });

    await alertCycle(h, listingId, 190_000);

    expect(
      ((await h.ruleState(ruleId)) as RuleState).units.product?.status,
    ).toBe('triggered');
  });
});

describe('REQ-CFG-004 secrets in stored errors', () => {
  it('redacts channel secrets and truncates long messages', async () => {
    const phone = new ScriptedNotifier();
    phone.failWith = () =>
      new DeliveryError(`bad token 123:ABC-secret ${'x'.repeat(2000)}`, false);
    const { h } = await setup(
      { phone },
      { secrets: { phone: ['123:ABC-secret'] } },
    );
    const listingId = await h.addListing(URL_A);
    await h.addRule('P1', 'target_price', { targetCents: 200_000 });

    await alertCycle(h, listingId, 190_000);

    const [row] = await rows(h);
    expect(row?.errorMessage).not.toContain('123:ABC-secret');
    expect(row?.errorMessage?.startsWith('bad token *** ')).toBe(true);
    expect(row?.errorMessage).toHaveLength(1000);
  });
});

describe('REQ-SCH-003 / REQ-SCH-004 system notices', () => {
  it('sends failing and recovered notices to PW_SYSTEM_CHANNELS, once each', async () => {
    const alerts = new ScriptedNotifier();
    const ops = new ScriptedNotifier();
    const { h } = await setup(
      { alerts, ops },
      { systemChannels: ['ops'], cycle: { config: { failingThreshold: 2 } } },
    );
    const listingId = await h.addListing(URL_A);
    h.adapter.script(
      URL_A,
      new BlockedError('captcha'),
      new BlockedError('captcha'),
      new BlockedError('captcha'),
      fakeResult(),
    );

    for (let i = 0; i < 3; i++) {
      h.clock.advance(30 * HOUR);
      await h.makeDue(listingId);
      await h.cycle.run('cli');
    }
    expect(ops.events.map((e) => e.event)).toEqual(['system.listing_failing']);

    h.clock.advance(30 * HOUR);
    await h.makeDue(listingId);
    await h.cycle.run('cli');

    expect(ops.events.map((e) => e.event)).toEqual([
      'system.listing_failing',
      'system.listing_recovered',
    ]);
    expect(alerts.events).toHaveLength(0);
    const failing = ops.events[0];
    expect(failing).toMatchObject({
      version: 1,
      listing: { id: listingId, url: URL_A },
      reason: 'Falhas consecutivas ao ler o anúncio: blocked: captcha',
    });
    const stored = await rows(h);
    expect(
      stored.every(
        (r) =>
          r.kind === 'system' && r.ruleId === null && r.listingId === listingId,
      ),
    ).toBe(true);
  });

  it('falls back to the default channels, and does nothing without channels', async () => {
    const only = new ScriptedNotifier();
    const { h } = await setup(
      { only },
      { cycle: { config: { failingThreshold: 1 } } },
    );
    const listingId = await h.addListing(URL_A);
    h.adapter.script(URL_A, new BlockedError('x'));
    await h.cycle.run('cli');
    expect(only.events.map((e) => e.event)).toEqual(['system.listing_failing']);
    expect(listingId).toBeTruthy();

    const { h: h2 } = await setup(
      {},
      { cycle: { config: { failingThreshold: 1 } } },
    );
    await h2.addListing(URL_A);
    h2.adapter.script(URL_A, new BlockedError('x'));
    await expect(h2.cycle.run('cli')).resolves.toMatchObject({
      summary: { failures: 1 },
    });
    expect(await rows(h2)).toHaveLength(0);
  });
});

describe('test notifications', () => {
  it('sendTest delivers a system.test event to one channel and records kind test', async () => {
    const phone = new ScriptedNotifier();
    const { h, service } = await setup({ phone });

    const result = await service.sendTest('PHONE');

    expect(result).toEqual({ channel: 'phone', ok: true });
    expect(phone.events[0]).toMatchObject({
      event: 'system.test',
      reason: 'Notificação de teste do pricewatch',
    });
    expect((await rows(h))[0]).toMatchObject({
      kind: 'test',
      ruleId: null,
      listingId: null,
    });
  });

  it('sendTest reports a failure instead of throwing', async () => {
    const phone = new ScriptedNotifier();
    phone.failWith = () => new DeliveryError('HTTP 403', false);
    const { service } = await setup({ phone });
    expect(await service.sendTest('phone')).toEqual({
      channel: 'phone',
      ok: false,
      error: 'HTTP 403',
    });
  });
});
