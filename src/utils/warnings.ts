import type { OriginMatcher, OriginValidator } from '../types';
import { LogLevel, OriginConstant, WarnOnceKey, buildWarnOnceKey, Messages, formatMessage } from '../constants';
import { logger } from './logger';

/**
 * Minimal "warnOnce host" interface.
 *
 * Why:
 * - We want to reuse the hub-level warnOnce mechanism without importing endpoint internals here.
 */
export interface WarnOnceHost {
  warnOnce: (key: string, fn: () => void) => void;
}

/**
 * Warn when using `targetOrigin="*"` for Window targets without any incoming origin validation.
 *
 * Why:
 * - For `Window` targets, default `targetOrigin` is '*'.
 * - If user does not configure `allowedOrigins` / `validateOrigin`, origin validation is effectively disabled.
 * - This is a best-practice/security warning and is logged once (INFO level) to avoid noise.
 */
export function warnUnsafeTargetOriginForWindow(params: {
  /** If true, the target is an iframe element (then this warning should not apply). */
  isIframeTarget: boolean;
  /** Effective targetOrigin (after user override). */
  targetOrigin: string;
  /** Allowed origins matcher (optional). */
  allowedOrigins?: OriginMatcher;
  /** Custom origin validator (optional). */
  validateOrigin?: OriginValidator;
}): void {
  if (params.isIframeTarget) return;
  if (params.targetOrigin !== OriginConstant.ANY) return;
  if (params.allowedOrigins || params.validateOrigin) return;

  logger.once(
    LogLevel.INFO,
    buildWarnOnceKey(WarnOnceKey.TARGET_ORIGIN_ANY_WITHOUT_ORIGIN_VALIDATION),
    '[Security] targetOrigin is "*" for Window targets and no allowedOrigins/validateOrigin is configured. ' +
      'Consider setting a strict targetOrigin and allowedOrigins/validateOrigin.'
  );
}

/**
 * Warn once when a client-side endpoint is already closed/destroyed and an inbound message arrives
 * without a matching pending request.
 *
 * This is a debugging hint (warn level) because it often indicates lifecycle issues:
 * - the client/server instance was recreated/unmounted before the response arrived
 */
export function warnClientServerIgnoredMessageWhenClosedOnce(
  host: WarnOnceHost,
  params: { type: string; requestId: string }
): void {
  host.warnOnce(buildWarnOnceKey(WarnOnceKey.INBOX_MISSING_PENDING_WHEN_CLOSED, params.requestId), () => {
    logger.warn(formatMessage(Messages.CLIENT_SERVER_IGNORED_MESSAGE_WHEN_CLOSED, params.type, params.requestId));
  });
}

/**
 * Warn once when a server-side endpoint is already closed/destroyed and it receives a message
 * that cannot be matched to a pending waiter (e.g. ack/pong/stream control frames).
 */
export function warnServerIgnoredMessageWhenClosedOnce(
  host: WarnOnceHost,
  params: { type: string; requestId: string }
): void {
  host.warnOnce(buildWarnOnceKey(WarnOnceKey.SERVER_MISSING_PENDING_WHEN_CLOSED, params.type, params.requestId), () => {
    logger.warn(formatMessage(Messages.SERVER_IGNORED_MESSAGE_WHEN_CLOSED, params.type, params.requestId));
  });
}

