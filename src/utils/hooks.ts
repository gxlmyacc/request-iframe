/**
 * A tiny "Tapable-like" hook implementation.
 *
 * Design goals:
 * - Zero dependencies
 * - Browser-friendly
 * - Familiar API surface (tap/call, tapPromise/promise)
 */

export interface HookTap<TArgs extends any[]> {
  name: string;
  fn: (...args: TArgs) => any;
}

/**
 * SyncHook - runs taps synchronously in registration order.
 */
export class SyncHook<TArgs extends any[] = any[]> {
  private readonly taps: HookTap<TArgs>[] = [];

  public tap(name: string, fn: (...args: TArgs) => void): () => void {
    const tap: HookTap<TArgs> = { name, fn };
    this.taps.push(tap);
    return () => {
      const idx = this.taps.indexOf(tap);
      if (idx >= 0) this.taps.splice(idx, 1);
    };
  }

  public call(...args: TArgs): void {
    for (const t of this.taps) {
      t.fn(...args);
    }
  }
}

/**
 * AsyncSeriesHook - runs taps in series, awaiting each.
 */
export class AsyncSeriesHook<TArgs extends any[] = any[]> {
  private readonly taps: HookTap<TArgs>[] = [];

  public tapPromise(name: string, fn: (...args: TArgs) => Promise<void>): () => void {
    const tap: HookTap<TArgs> = { name, fn };
    this.taps.push(tap);
    return () => {
      const idx = this.taps.indexOf(tap);
      if (idx >= 0) this.taps.splice(idx, 1);
    };
  }

  public tap(name: string, fn: (...args: TArgs) => void | Promise<void>): () => void {
    return this.tapPromise(name, async (...args: TArgs) => {
      await fn(...args);
    });
  }

  public async promise(...args: TArgs): Promise<void> {
    for (const t of this.taps) {
      await t.fn(...args);
    }
  }
}

