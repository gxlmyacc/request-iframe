import { RequestIframeServer, RequestIframeServerOptions } from '../types';
import { RequestIframeServerImpl } from '../core/server';
import { setupServerDebugListeners } from '../utils/debug';

/**
 * Create a server (for receiving and handling requests)
 * 
 * Note:
 * - MessageChannel is cached at the window level by secretKey (ensures unique message listener)
 * - Server instances are not cached, a new instance is created on each call
 * - This allows different versions of the library to coexist
 */
export function requestIframeServer(
  options?: RequestIframeServerOptions
): RequestIframeServer {
  // Determine secretKey
  const secretKey = options?.secretKey;
  
  // Create server (internally obtains or creates a shared MessageChannel)
  const server = new RequestIframeServerImpl({
    secretKey,
    ackTimeout: options?.ackTimeout
  });

  // If trace mode is enabled, register debug listeners
  if (options?.trace) {
    setupServerDebugListeners(server);
  }

  return server;
}

/**
 * Clear MessageChannel cache (for testing or reset)
 * Note: This clears the shared message channel for the specified secretKey
 */
export function clearRequestIframeServerCache(secretKey?: string): void {
  // Now server is no longer cached, only need to clear MessageChannel cache
  // MessageChannel cleanup is handled by clearMessageChannelCache in cache.ts
  // Empty implementation kept here to maintain API compatibility
  void secretKey;
}
