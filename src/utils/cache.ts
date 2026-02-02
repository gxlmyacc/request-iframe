import { RequestIframeServer } from '../types';

/**
 * Global cache Symbol for server instances
 * Using Symbol.for() ensures multiple library copies share the same cache
 */
const SERVER_CACHE_SYMBOL = Symbol.for('__requestIframeServerCache__');

/**
 * Get the server cache from window
 */
function getServerCacheForWindow(win: Window): Map<string, RequestIframeServer> {
  if (!(SERVER_CACHE_SYMBOL in win)) {
    (win as any)[SERVER_CACHE_SYMBOL] = new Map<string, RequestIframeServer>();
  }
  return (win as any)[SERVER_CACHE_SYMBOL];
}

/**
 * Generate server cache key
 * Cache key format: "secretKey:id" or "secretKey:" when no id
 */
function getServerCacheKey(secretKey?: string, id?: string): string {
  return `${secretKey ?? ''}:${id ?? ''}`;
}

/**
 * Get cached server instance or null
 * @param secretKey secret key for message isolation
 * @param id server instance ID
 */
export function getCachedServer(
  secretKey?: string,
  id?: string
): RequestIframeServer | null {
  if (!id) return null;
  
  const cache = getServerCacheForWindow(window);
  const key = getServerCacheKey(secretKey, id);
  return cache.get(key) || null;
}

/**
 * Cache server instance
 * @param server server instance
 * @param secretKey secret key for message isolation
 * @param id server instance ID
 */
export function cacheServer(
  server: RequestIframeServer,
  secretKey?: string,
  id?: string
): void {
  if (!id) return;
  
  const cache = getServerCacheForWindow(window);
  const key = getServerCacheKey(secretKey, id);
  cache.set(key, server);
}

/**
 * Remove server from cache
 * @param secretKey secret key for message isolation
 * @param id server instance ID
 */
export function removeCachedServer(secretKey?: string, id?: string): void {
  if (!id) return;
  
  const cache = getServerCacheForWindow(window);
  const key = getServerCacheKey(secretKey, id);
  cache.delete(key);
}

/**
 * Clear server cache (mainly for testing).
 *
 * - No args: clear all cached servers
 * - With secretKey: only clear servers under that secretKey
 * - With { secretKey, id }: only clear the specified server instance
 * - With { id }: clear the specified id across all secretKeys
 */
export function clearServerCache(arg?: string | { secretKey?: string; id?: string }): void {
  const cache = getServerCacheForWindow(window);
  if (!arg) {
    cache.forEach((server) => {
      server.destroy();
    });
    cache.clear();
    return;
  }

  const params = typeof arg === 'string' ? { secretKey: arg } : arg;
  const prefix = typeof params.secretKey === 'string' ? `${params.secretKey}:` : undefined;
  const suffix = typeof params.id === 'string' ? `:${params.id}` : undefined;
  cache.forEach((server, key) => {
    if (prefix && !key.startsWith(prefix)) return;
    if (suffix && !key.endsWith(suffix)) return;
    cache.delete(key);
    server.destroy();
  });
}
