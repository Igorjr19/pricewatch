import type { CycleService } from './cycle.service.js';

/** REQ-RUN-001/005: runs a cycle every tick, never two at once in this process. */
export class Ticker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly cycle: CycleService,
    private readonly tickMs: number,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
  }

  /** Returns false if a cycle was already in progress here. */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = this.cycle
      .run('ticker', this.abort.signal)
      .catch(this.onError)
      .finally(() => {
        this.running = null;
      });
    await this.running;
    return true;
  }

  /** REQ-RUN-006: stop starting listings and wait for the in-flight cycle. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    await this.running;
  }
}
