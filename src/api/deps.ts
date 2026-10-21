import type { Clock } from '../common/clock.js';
import type { LogLevel } from '../common/logger.js';
import type { Database } from '../db/database.js';
import type { AdapterRegistry } from '../monitor/adapters/registry.js';
import type { CollectorService } from '../monitor/collector.service.js';
import type { CycleService } from '../monitor/cycle.service.js';
import type { SchedulerService } from '../monitor/scheduler.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { ChannelConfig } from '../notifications/types.js';

export const API_DEPS = Symbol('API_DEPS');

export interface ApiDeps {
  db: Database;
  clock: Clock;
  registry: AdapterRegistry;
  collector: CollectorService;
  scheduler: SchedulerService;
  cycle: CycleService;
  notifications: NotificationService;
  channels: ChannelConfig[];
  apiToken?: string;
  runToken?: string;
  version: string;
  browserAvailable: boolean;
  /** HTTP request logging; omitted means silent (tests). */
  logLevel?: LogLevel;
  /** Aborted on shutdown so a cycle started through `POST /run` stops too (REQ-RUN-006). */
  shutdownSignal?: AbortSignal;
}
