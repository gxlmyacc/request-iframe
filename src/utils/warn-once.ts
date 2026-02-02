/**
 * A simple global warn-once helper.
 *
 * Why:
 * - Some warnings need to fire before a hub/client/server instance exists (e.g. api factory functions).
 * - We use Symbol.for() so multiple bundles/versions can share the same dedupe storage.
 */

const WARN_ONCE_SYMBOL = Symbol.for('__requestIframeWarnOnce__');

function getHost(): any {
  if (typeof window !== 'undefined') return window as any;
  return globalThis as any;
}

function getWarnOnceSet(): Set<string> {
  const host = getHost();
  if (!(WARN_ONCE_SYMBOL in host)) {
    host[WARN_ONCE_SYMBOL] = new Set<string>();
  }
  return host[WARN_ONCE_SYMBOL] as Set<string>;
}

export function warnOnce(key: string, fn: () => void): void {
  const set = getWarnOnceSet();
  if (set.has(key)) return;
  set.add(key);
  fn();
}

