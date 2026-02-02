import { RequestIframeServer, RequestIframeServerOptions } from '../types';
import { RequestIframeServerImpl } from '../impl/server';
import { setRequestIframeLogLevel } from '../utils/logger';
import { getCachedServer, cacheServer, clearServerCache } from '../utils/cache';
import { LogLevel } from '../constants';
import { loadDebugModule } from '../utils/debug-lazy';
import { applyStrictServerSecurityDefaults } from '../utils/strict-mode';

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
  const resolvedOptions = applyStrictServerSecurityDefaults(options) ?? options;
  // Determine secretKey and id
  const secretKey = resolvedOptions?.secretKey;
  const id = resolvedOptions?.id;
  
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
    ackTimeout: resolvedOptions?.ackTimeout,
    autoOpen: resolvedOptions?.autoOpen,
    allowedOrigins: resolvedOptions?.allowedOrigins,
    validateOrigin: resolvedOptions?.validateOrigin,
    maxConcurrentRequestsPerClient: resolvedOptions?.maxConcurrentRequestsPerClient,
    autoAckMaxMetaLength: resolvedOptions?.autoAckMaxMetaLength,
    autoAckMaxIdLength: resolvedOptions?.autoAckMaxIdLength
  });

  /**
   * Trace/log level:
   * - default: only warn/error will be printed (logger default)
   * - if trace enabled: raise log level and (optionally) enable detailed debug listeners
   */
  if (resolvedOptions?.trace) {
    const level = resolvedOptions.trace === true ? LogLevel.TRACE : resolvedOptions.trace;
    setRequestIframeLogLevel(level);
    if (level === LogLevel.TRACE || level === LogLevel.INFO) {
      /**
       * Lazy-load debug hooks to keep main bundle smaller.
       * Best-effort: ignore dynamic import errors.
       */
      void loadDebugModule()
        .then((m) => m.setupServerDebugListeners(server))
        .catch(() => {
          /** ignore */
        });
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
