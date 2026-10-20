import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Timestamps are ISO 8601 UTC strings; ids are ULIDs (spec section 5).

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const listings = sqliteTable(
  'listings',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    adapterId: text('adapter_id').notNull(),
    url: text('url').notNull().unique(),
    externalId: text('external_id'),
    status: text('status', { enum: ['active', 'paused', 'failing'] })
      .notNull()
      .default('active'),
    checkIntervalMinutes: integer('check_interval_minutes'),
    nextCheckAt: text('next_check_at').notNull(),
    lastCheckedAt: text('last_checked_at'),
    lastSuccessAt: text('last_success_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('listings_status_next_check_idx').on(t.status, t.nextCheckAt)],
);

export const observations = sqliteTable(
  'observations',
  {
    id: text('id').primaryKey(),
    listingId: text('listing_id')
      .notNull()
      .references(() => listings.id),
    observedAt: text('observed_at').notNull(),
    priceCents: integer('price_cents'),
    pixPriceCents: integer('pix_price_cents'),
    effectivePriceCents: integer('effective_price_cents'),
    installmentCount: integer('installment_count'),
    installmentPriceCents: integer('installment_price_cents'),
    inStock: integer('in_stock', { mode: 'boolean' }).notNull(),
    seller: text('seller'),
    title: text('title'),
    strategy: text('strategy', { enum: ['api', 'http', 'browser'] }).notNull(),
  },
  (t) => [
    index('observations_listing_observed_idx').on(t.listingId, t.observedAt),
  ],
);

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  trigger: text('trigger', { enum: ['ticker', 'cli', 'api'] }).notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', {
    enum: ['running', 'completed', 'timed_out', 'failed'],
  }).notNull(),
  listingsDue: integer('listings_due').notNull().default(0),
  listingsChecked: integer('listings_checked').notNull().default(0),
  successes: integer('successes').notNull().default(0),
  failures: integer('failures').notNull().default(0),
  notificationsSent: integer('notifications_sent').notNull().default(0),
});

export const fetchAttempts = sqliteTable('fetch_attempts', {
  id: text('id').primaryKey(),
  listingId: text('listing_id')
    .notNull()
    .references(() => listings.id),
  runId: text('run_id').references(() => runs.id),
  startedAt: text('started_at').notNull(),
  durationMs: integer('duration_ms'),
  strategy: text('strategy', { enum: ['api', 'http', 'browser'] }).notNull(),
  outcome: text('outcome', {
    enum: [
      'ok',
      'blocked',
      'not_found',
      'parse_error',
      'http_error',
      'timeout',
      'strategy_unavailable',
    ],
  }).notNull(),
  httpStatus: integer('http_status'),
  errorMessage: text('error_message'),
});

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  type: text('type', {
    enum: ['target_price', 'new_low', 'back_in_stock'],
  }).notNull(),
  params: text('params', { mode: 'json' }).notNull(),
  channels: text('channels', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  cooldownMinutes: integer('cooldown_minutes'),
  state: text('state', { mode: 'json' }),
  lastTriggeredAt: text('last_triggered_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').references(() => rules.id, { onDelete: 'set null' }),
  listingId: text('listing_id').references(() => listings.id, {
    onDelete: 'set null',
  }),
  observationId: text('observation_id').references(() => observations.id, {
    onDelete: 'set null',
  }),
  channel: text('channel').notNull(),
  kind: text('kind', { enum: ['alert', 'system', 'test'] }).notNull(),
  status: text('status', { enum: ['sent', 'failed'] }).notNull(),
  payload: text('payload', { mode: 'json' }),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});

/** Single row, `id = 1`. */
export const runLock = sqliteTable('run_lock', {
  id: integer('id').primaryKey(),
  holder: text('holder').notNull(),
  acquiredAt: text('acquired_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});
