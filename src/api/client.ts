import { ErrorResponse, RequestIframeClient, RequestIframeClientOptions } from '../types';
import { getIframeTargetOrigin } from '../utils/iframe';
import { generateInstanceId } from '../utils/id';
import { RequestIframeClientImpl } from '../impl/client';
import { setupClientDebugInterceptors } from '../utils/debug';
import { setRequestIframeLogLevel } from '../utils/logger';
import { Messages, ErrorCode, OriginConstant, LogLevel } from '../constants';
import { clearMessageChannelCache } from '../message/channel-cache';

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
  let targetOrigin: string = OriginConstant.ANY;

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
    targetOrigin = OriginConstant.ANY;
  }

  // Allow user to override targetOrigin explicitly
  if (options?.targetOrigin) {
    targetOrigin = options.targetOrigin;
  }

  // Determine secretKey
  const secretKey = options?.secretKey;
  
  // Generate instance ID first (will be used by both client and server)
  const instanceId = generateInstanceId();

  // Create client instance (internally creates its core message server)
  const client = new RequestIframeClientImpl(targetWindow, targetOrigin, {
    secretKey,
    ackTimeout: options?.ackTimeout,
    timeout: options?.timeout,
    asyncTimeout: options?.asyncTimeout,
    returnData: options?.returnData,
    headers: options?.headers,
    allowedOrigins: options?.allowedOrigins,
    validateOrigin: options?.validateOrigin,
    autoOpen: options?.autoOpen,
    autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
    autoAckMaxIdLength: options?.autoAckMaxIdLength
  }, instanceId);

  /**
   * Trace/log level:
   * - default: only warn/error will be printed (logger default)
   * - if trace enabled: raise log level and (optionally) enable detailed debug interceptors
   */
  if (options?.trace) {
    const level = options.trace === true ? LogLevel.TRACE : options.trace;
    setRequestIframeLogLevel(level);
    if (level === LogLevel.TRACE || level === LogLevel.INFO) {
      setupClientDebugInterceptors(client);
    }
  }

  return client;
}

/**
 * Clear MessageChannel cache (for testing or reset)
 * Note: This clears the shared message channel for the specified secretKey
 */
export function clearRequestIframeClientCache(secretKey?: string): void {
  // Client is not cached; this helper only clears shared MessageChannel cache.
  // If secretKey is provided, only clear channels under that secretKey.
  if (typeof secretKey === 'string') {
    clearMessageChannelCache(secretKey);
    return;
  }
  clearMessageChannelCache();
}
