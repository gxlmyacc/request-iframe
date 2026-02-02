/**
 * Lazy-load debug helpers (dynamic import) with shared caching.
 *
 * Why:
 * - Avoid eagerly bundling debug wiring into the main bundle.
 * - Keep one shared Promise so multiple entry points don't trigger multiple imports.
 */

import type { RequestIframeClient } from '../types';

let debugModulePromise: Promise<typeof import('./debug')> | null = null;

export function loadDebugModule(): Promise<typeof import('./debug')> {
  if (!debugModulePromise) {
    debugModulePromise = import('./debug');
  }
  return debugModulePromise;
}

const CLIENT_DEBUG_STATE = new WeakMap<object, { promise: Promise<void> | null; attached: boolean }>();
const CLIENT_DEBUG_WRAPPED = Symbol.for('__requestIframeClientDebugWrapped__');

/**
 * Ensure debug interceptors/listeners are attached to a client instance.
 *
 * Notes:
 * - This returns a Promise that never rejects (best-effort).
 * - It is safe to call multiple times; only attaches once per client instance.
 */
export function ensureClientDebugInterceptors(client: RequestIframeClient): Promise<void> {
  const key = client as unknown as object;
  let state = CLIENT_DEBUG_STATE.get(key);
  if (!state) {
    state = { promise: null, attached: false };
    CLIENT_DEBUG_STATE.set(key, state);
  }
  if (state.attached) return Promise.resolve();
  if (!state.promise) {
    state.promise = loadDebugModule()
      .then((m) => {
        if (state!.attached) return;
        m.setupClientDebugInterceptors(client);
        state!.attached = true;
      })
      .catch(() => {
        /** ignore */
      });
  }
  return state.promise;
}

/**
 * Wrap client send methods so the first request in trace mode won't miss debug hooks.
 *
 * Why:
 * - debug module is lazy-loaded via dynamic import, so it may not be ready immediately.
 * - In trace mode, it's acceptable to delay the first send by a microtask or module-load time.
 */
export function wrapClientMethodsForDebug(client: RequestIframeClient): void {
  const c: any = client as any;
  if (c[CLIENT_DEBUG_WRAPPED]) return;
  c[CLIENT_DEBUG_WRAPPED] = true;

  const wrapAsyncMethod = (name: string) => {
    const original = c[name];
    if (typeof original !== 'function') return;
    const bound = original.bind(c);
    c[name] = (...args: any[]) => {
      return ensureClientDebugInterceptors(client).then(() => bound(...args));
    };
  };

  wrapAsyncMethod('send');
  wrapAsyncMethod('sendFile');
  wrapAsyncMethod('sendStream');
  wrapAsyncMethod('isConnect');
}

