import { ErrorResponse, RequestIframeClient, RequestIframeClientOptions } from '../types';
import { getIframeTargetOrigin, generateInstanceId } from '../utils';
import { RequestIframeClientServer } from '../core/client-server';
import { RequestIframeClientImpl } from '../core/client';
import { setupClientDebugInterceptors } from '../utils/debug';
import { Messages, ErrorCode } from '../constants';

/**
 * Create a client (for sending requests)
 * 
 * Note:
 * - MessageChannel is cached at the window level by secretKey (ensures unique message listener)
 * - Client instances are not cached, a new instance is created on each call
 * - This allows different versions of the library to coexist
 */
export function requestIframeClient(
  target: HTMLIFrameElement | Window,
  options?: RequestIframeClientOptions
): RequestIframeClient {
  let targetWindow: Window | null = null;
  let targetOrigin = '*';

  if ((target as HTMLIFrameElement).tagName === 'IFRAME') {
    const iframe = target as HTMLIFrameElement;
    targetWindow = iframe.contentWindow;
    targetOrigin = getIframeTargetOrigin(iframe);
    if (!targetWindow) {
      throw {
        message: Messages.IFRAME_NOT_READY,
        code: ErrorCode.IFRAME_NOT_READY
      } as ErrorResponse;
    }
  } else {
    targetWindow = target as Window;
    targetOrigin = '*';
  }

  // Determine secretKey
  const secretKey = options?.secretKey;
  
  // Generate instance ID first (will be used by both client and server)
  const instanceId = generateInstanceId();
  
  // Create ClientServer (internally obtains or creates a shared MessageChannel)
  const server = new RequestIframeClientServer({
    secretKey,
    ackTimeout: options?.ackTimeout,
    autoOpen: options?.autoOpen
  }, instanceId);
  
  // Create client instance
  const client = new RequestIframeClientImpl(targetWindow, targetOrigin, server, {
    secretKey,
    ackTimeout: options?.ackTimeout,
    timeout: options?.timeout,
    asyncTimeout: options?.asyncTimeout,
    returnData: options?.returnData,
    headers: options?.headers
  }, instanceId);

  // If trace mode is enabled, register debug interceptors
  if (options?.trace) {
    setupClientDebugInterceptors(client);
  }

  return client;
}

/**
 * Clear MessageChannel cache (for testing or reset)
 * Note: This clears the shared message channel for the specified secretKey
 */
export function clearRequestIframeClientCache(secretKey?: string): void {
  // Now client is no longer cached, only need to clear MessageChannel cache
  // MessageChannel cleanup is handled by clearMessageChannelCache in cache.ts
  // Empty implementation kept here to maintain API compatibility
  void secretKey;
}
