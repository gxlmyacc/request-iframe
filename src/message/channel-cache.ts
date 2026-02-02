import { MessageChannel, ChannelType } from './channel';

/**
 * Global cache Symbol (used to store MessageChannel instance cache on window/globalThis).
 *
 * NOTE:
 * - We MUST use Symbol.for() so multiple library copies (different bundles/versions)
 *   can share the same cache.
 * - Keep the symbol key stable for backward compatibility with older releases.
 */
const MESSAGE_CHANNEL_CACHE_SYMBOL = Symbol.for('__requestIframeMessageChannelCache__');

/**
 * Get the cache host object.
 *
 * We prefer `window` because MessageChannel itself is window-based (postMessage listener),
 * and existing versions store the cache on window as well.
 */
function getCacheHost(): any {
  if (typeof window !== 'undefined') return window as any;
  // Fallback for non-browser environments; creating MessageChannel will likely fail anyway.
  return globalThis as any;
}

/**
 * Get the MessageChannel cache Map from the host.
 */
function getChannelCache(): Map<string, MessageChannel> {
  const host = getCacheHost();
  if (!(MESSAGE_CHANNEL_CACHE_SYMBOL in host)) {
    host[MESSAGE_CHANNEL_CACHE_SYMBOL] = new Map<string, MessageChannel>();
  }
  return host[MESSAGE_CHANNEL_CACHE_SYMBOL] as Map<string, MessageChannel>;
}

/**
 * Generate cache key.
 * Format: "type:secretKey" or "type:" when no secretKey.
 */
function getCacheKey(type: ChannelType, secretKey?: string): string {
  return `${type}:${secretKey ?? ''}`;
}

/**
 * Get or create MessageChannel instance.
 *
 * - Within the same window, only one channel is created per type + secretKey.
 * - Uses reference counting to manage lifecycle.
 */
export function getOrCreateMessageChannel(
  secretKey?: string,
  type: ChannelType = ChannelType.POST_MESSAGE
): MessageChannel {
  const cache = getChannelCache();
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
 * Release MessageChannel reference.
 *
 * - When reference count reaches 0, destroy channel and remove from cache.
 */
export function releaseMessageChannel(channel: MessageChannel): void {
  const refCount = channel.release();
  if (refCount > 0) return;

  const cache = getChannelCache();
  const key = getCacheKey(channel.type, channel.secretKey);
  if (cache.get(key) === channel) {
    cache.delete(key);
    channel.destroy();
  }
}

/**
 * Clear MessageChannel cache (mainly for testing).
 *
 * - No args: clear all channels
 * - string arg: treated as secretKey filter
 * - params arg: filter by secretKey/type
 */
export function clearMessageChannelCache(
  arg?: string | { secretKey?: string; type?: ChannelType }
): void {
  const cache = getChannelCache();
  if (!arg) {
    cache.forEach((channel) => {
      channel.destroy();
    });
    cache.clear();
    return;
  }

  const params = typeof arg === 'string' ? { secretKey: arg } : arg;
  cache.forEach((channel, key) => {
    if (params.type && channel.type !== params.type) return;
    if (typeof params.secretKey === 'string' && channel.secretKey !== params.secretKey) return;
    cache.delete(key);
    channel.destroy();
  });
}

