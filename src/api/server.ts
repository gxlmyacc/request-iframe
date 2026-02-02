import { RequestIframeServer, RequestIframeServerOptions } from '../types';
import { RequestIframeServerImpl } from '../impl/server';
import { setupServerDebugListeners } from '../utils/debug';
import { setRequestIframeLogLevel } from '../utils/logger';
import { getCachedServer, cacheServer, clearServerCache } from '../utils/cache';
import { LogLevel } from '../constants';

/**
 * Create a server (for receiving and handling requests)
 * 
 * Note:
 * - MessageChannel is cached at the window level by secretKey (ensures unique message listener)
 * - If options.id is specified, the server will be cached and reused (singleton pattern)
 * - If options.id is not specified, a new instance is created on each call
 * - This allows different versions of the library to coexist
 */
export function requestIframeServer(
  options?: RequestIframeServerOptions
): RequestIframeServer {
  // Determine secretKey and id
  const secretKey = options?.secretKey;
  const id = options?.id;
  
  // If id is specified, check cache first
  if (id) {
    const cached = getCachedServer(secretKey, id);
    if (cached) {
      return cached;
    }
  }
  
  // Create server (internally obtains or creates a shared MessageChannel)
  const server = new RequestIframeServerImpl({
    secretKey,
    id,
    ackTimeout: options?.ackTimeout,
    autoOpen: options?.autoOpen,
    allowedOrigins: options?.allowedOrigins,
    validateOrigin: options?.validateOrigin,
    maxConcurrentRequestsPerClient: options?.maxConcurrentRequestsPerClient,
    autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
    autoAckMaxIdLength: options?.autoAckMaxIdLength
  });

  /**
   * Trace/log level:
   * - default: only warn/error will be printed (logger default)
   * - if trace enabled: raise log level and (optionally) enable detailed debug listeners
   */
  if (options?.trace) {
    const level = options.trace === true ? LogLevel.TRACE : options.trace;
    setRequestIframeLogLevel(level);
    if (level === LogLevel.TRACE || level === LogLevel.INFO) {
      setupServerDebugListeners(server);
    }
  }

  // Cache server if id is specified
  if (id) {
    cacheServer(server, secretKey, id);
  }

  return server;
}

/**
 * Clear server cache (for testing or reset)
 * Note: This clears the cached server instances
 */
export function clearRequestIframeServerCache(
  arg?: string | { secretKey?: string; id?: string }
): void {
  /** Clear server cache */
  clearServerCache(arg);
}
