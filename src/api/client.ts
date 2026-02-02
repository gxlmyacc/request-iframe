import { ErrorResponse, RequestIframeClient, RequestIframeClientOptions } from '../types';
import { getIframeTargetOrigin } from '../utils/iframe';
import { generateInstanceId } from '../utils/id';
import { RequestIframeClientImpl } from '../impl/client';
import { setRequestIframeLogLevel } from '../utils/logger';
import { Messages, ErrorCode, OriginConstant, LogLevel } from '../constants';
import { clearMessageChannelCache } from '../message/channel-cache';
import { warnUnsafeTargetOriginForWindow } from '../utils/warnings';
import { ensureClientDebugInterceptors, loadDebugModule, wrapClientMethodsForDebug } from '../utils/debug-lazy';
import { applyStrictClientSecurityDefaults } from '../utils/strict-mode';

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
  let defaultTargetOrigin: string = OriginConstant.ANY;

  if ((target as HTMLIFrameElement).tagName === 'IFRAME') {
    const iframe = target as HTMLIFrameElement;
    targetWindow = iframe.contentWindow;
    defaultTargetOrigin = getIframeTargetOrigin(iframe);
    if (!targetWindow) {
      throw {
        message: Messages.IFRAME_NOT_READY,
        code: ErrorCode.IFRAME_NOT_READY
      } as ErrorResponse;
    }
  } else {
    targetWindow = target as Window;
    defaultTargetOrigin = OriginConstant.ANY;
  }

  const resolved = applyStrictClientSecurityDefaults(defaultTargetOrigin, options);
  const targetOrigin = resolved.targetOrigin;
  const resolvedOptions = resolved.options ?? options;

  /**
   * P1: warn on unsafe default targetOrigin for Window targets.
   * - If targetOrigin is '*' and user did not configure allowedOrigins/validateOrigin,
   *   incoming message origin validation is effectively disabled.
   */
  warnUnsafeTargetOriginForWindow({
    isIframeTarget: (target as any).tagName === 'IFRAME',
    targetOrigin,
    allowedOrigins: resolvedOptions?.allowedOrigins,
    validateOrigin: resolvedOptions?.validateOrigin
  });

  // Determine secretKey
  const secretKey = resolvedOptions?.secretKey;
  
  // Generate instance ID first (will be used by both client and server)
  const instanceId = generateInstanceId();

  // Create client instance (internally creates its core message server)
  const client = new RequestIframeClientImpl(targetWindow, targetOrigin, {
    secretKey,
    ackTimeout: resolvedOptions?.ackTimeout,
    timeout: resolvedOptions?.timeout,
    asyncTimeout: resolvedOptions?.asyncTimeout,
    returnData: resolvedOptions?.returnData,
    headers: resolvedOptions?.headers,
    allowedOrigins: resolvedOptions?.allowedOrigins,
    validateOrigin: resolvedOptions?.validateOrigin,
    autoOpen: resolvedOptions?.autoOpen,
    autoAckMaxMetaLength: resolvedOptions?.autoAckMaxMetaLength,
    autoAckMaxIdLength: resolvedOptions?.autoAckMaxIdLength
  }, instanceId);

  /**
   * Trace/log level:
   * - default: only warn/error will be printed (logger default)
   * - if trace enabled: raise log level and (optionally) enable detailed debug interceptors
   */
  if (resolvedOptions?.trace) {
    const level = resolvedOptions.trace === true ? LogLevel.TRACE : resolvedOptions.trace;
    setRequestIframeLogLevel(level);
    if (level === LogLevel.TRACE || level === LogLevel.INFO) {
      /**
       * Lazy-load debug hooks to keep main bundle smaller, but still ensure
       * the first request in trace mode won't miss debug interceptors.
       */
      wrapClientMethodsForDebug(client);
      // Preheat import early (best-effort)
      void loadDebugModule().catch(() => {
        /** ignore */
      });
      // Attach ASAP (best-effort)
      void ensureClientDebugInterceptors(client);
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
