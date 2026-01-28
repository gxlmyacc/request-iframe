import { MessageChannel, ChannelType } from '../message';
import { RequestIframeServer } from '../types';

/**
 * Global cache Symbol (used to store MessageChannel instance cache on window)
 * Using Symbol.for() ensures multiple library copies share the same cache, avoiding multiple instance creation
 */
const MESSAGE_CHANNEL_CACHE_SYMBOL = Symbol.for('__requestIframeMessageChannelCache__');

/**
 * Global cache Symbol for server instances
 * Using Symbol.for() ensures multiple library copies share the same cache
 */
const SERVER_CACHE_SYMBOL = Symbol.for('__requestIframeServerCache__');

/**
 * Get the MessageChannel cache from window
 */
function getChannelCacheForWindow(win: Window): Map<string, MessageChannel> {
  if (!(MESSAGE_CHANNEL_CACHE_SYMBOL in win)) {
    (win as any)[MESSAGE_CHANNEL_CACHE_SYMBOL] = new Map<string, MessageChannel>();
  }
  return (win as any)[MESSAGE_CHANNEL_CACHE_SYMBOL];
}

/**
 * Generate cache key
 * Cache key format: "type:secretKey" or "type:" when no secretKey
 * Different channel types use separate cache entries
 */
function getCacheKey(type: ChannelType, secretKey?: string): string {
  return `${type}:${secretKey ?? ''}`;
}

/**
 * Get or create MessageChannel instance
 * - Within the same window, only one channel is created per type + secretKey combination
 * - Uses reference counting to manage lifecycle
 * @param secretKey secret key for message isolation
 * @param type channel type (defaults to postMessage)
 */
export function getOrCreateMessageChannel(
  secretKey?: string,
  type: ChannelType = ChannelType.POST_MESSAGE
): MessageChannel {
  const cache = getChannelCacheForWindow(window);
  const key = getCacheKey(type, secretKey);
  
  let channel = cache.get(key);
  if (!channel) {
    channel = new MessageChannel(secretKey, type);
    cache.set(key, channel);
  }
  
  channel.addRef();
  return channel;
}

/**
 * Release MessageChannel reference
 * - When reference count reaches 0, destroy channel and remove from cache
 */
export function releaseMessageChannel(channel: MessageChannel): void {
  const refCount = channel.release();
  
  if (refCount <= 0) {
    const cache = getChannelCacheForWindow(window);
    const key = getCacheKey(channel.type, channel.secretKey);
    
    if (cache.get(key) === channel) {
      cache.delete(key);
      channel.destroy();
    }
  }
}

/**
 * Clear all MessageChannel cache (mainly for testing)
 */
export function clearMessageChannelCache(): void {
  const cache = getChannelCacheForWindow(window);
  cache.forEach((channel) => {
    channel.destroy();
  });
  cache.clear();
}

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
 * Clear all server cache (mainly for testing)
 */
export function clearServerCache(): void {
  const cache = getServerCacheForWindow(window);
  cache.forEach((server) => {
    server.destroy();
  });
  cache.clear();
}
