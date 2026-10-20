/** Injected wherever "now" or waiting matters, so tests never use Date.now() or real timers. */
export abstract class Clock {
  abstract now(): Date;
  abstract sleep(ms: number): Promise<void>;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
