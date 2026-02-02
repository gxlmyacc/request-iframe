import type { OriginMatcher, OriginValidator } from '../types';

/**
 * Security defaults helper for "strict mode".
 *
 * Goal:
 * - Reduce boilerplate in common same-origin usage.
 * - Provide safer defaults when user does NOT configure origin constraints explicitly.
 *
 * Behavior (when strict === true):
 * - Client-like options:
 *   - If targetOrigin is not provided, default to window.location.origin (same-origin only).
 *   - If neither allowedOrigins nor validateOrigin is provided, default allowedOrigins to [window.location.origin].
 * - Server-like options:
 *   - If neither allowedOrigins nor validateOrigin is provided, default allowedOrigins to [window.location.origin].
 *
 * Notes:
 * - This intentionally makes cross-origin setups fail fast unless user explicitly configures
 *   targetOrigin and allowedOrigins/validateOrigin.
 */

export interface StrictClientSecurityOptionsShape {
  strict?: boolean;
  targetOrigin?: string;
  allowedOrigins?: OriginMatcher;
  validateOrigin?: OriginValidator;
}

export interface StrictServerSecurityOptionsShape {
  strict?: boolean;
  allowedOrigins?: OriginMatcher;
  validateOrigin?: OriginValidator;
}

export function getCurrentWindowOrigin(): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const origin = window.location?.origin;
    if (typeof origin === 'string' && origin) return origin;
  } catch {
    /** ignore */
  }
  return undefined;
}

export function applyStrictClientSecurityDefaults<T extends StrictClientSecurityOptionsShape>(
  defaultTargetOrigin: string,
  options?: T
): { targetOrigin: string; options?: T } {
  const strict = options?.strict === true;
  let targetOrigin = options?.targetOrigin ?? defaultTargetOrigin;
  let allowedOrigins = options?.allowedOrigins;

  if (strict) {
    const currentOrigin = getCurrentWindowOrigin();
    if (currentOrigin) {
      if (!options?.targetOrigin) {
        targetOrigin = currentOrigin;
      }
      if (!options?.allowedOrigins && !options?.validateOrigin) {
        allowedOrigins = [currentOrigin];
      }
    }
  }

  if (!options) {
    return { targetOrigin, options: options };
  }

  if (targetOrigin === options.targetOrigin && allowedOrigins === options.allowedOrigins) {
    return { targetOrigin, options };
  }

  return {
    targetOrigin,
    options: {
      ...options,
      ...(targetOrigin !== options.targetOrigin ? { targetOrigin } : null),
      ...(allowedOrigins !== options.allowedOrigins ? { allowedOrigins } : null)
    } as T
  };
}

export function applyStrictServerSecurityDefaults<T extends StrictServerSecurityOptionsShape>(options?: T): T | undefined {
  const strict = options?.strict === true;
  if (!strict) return options;

  if (options?.allowedOrigins || options?.validateOrigin) {
    return options;
  }

  const currentOrigin = getCurrentWindowOrigin();
  if (!currentOrigin) return options;

  return {
    ...options,
    allowedOrigins: [currentOrigin]
  } as T;
}

