/**
 * warnOnce keys (for deduplication).
 *
 * Keep these centralized to avoid scattered magic strings.
 */

export const WarnOnceKey = {
  INBOX_MISSING_PENDING_WHEN_CLOSED: 'inbox:missingPendingWhenClosed',
  SERVER_MISSING_PENDING_WHEN_CLOSED: 'server:missingPendingWhenClosed',
  /**
   * Security warning:
   * - targetOrigin is '*'
   * - and no allowedOrigins/validateOrigin is configured
   */
  TARGET_ORIGIN_ANY_WITHOUT_ORIGIN_VALIDATION: 'targetOrigin:anyWithoutOriginValidation'
} as const;

export type WarnOnceKeyValue = typeof WarnOnceKey[keyof typeof WarnOnceKey];

export function buildWarnOnceKey(prefix: WarnOnceKeyValue, ...parts: Array<string | number>): string {
  if (!parts.length) return prefix;
  return `${prefix}:${parts.map(String).join(':')}`;
}

