/**
 * Origin matcher type (supports string, RegExp, Array)
 */
export type OriginMatcher = string | RegExp | Array<string | RegExp>;

/**
 * Match origin by matcher.
 *
 * Notes:
 * - string: exact match. Special case: '*' means allow all.
 * - RegExp: test against origin string.
 * - Array: any item matches.
 */
export function matchOrigin(origin: string, matcher: OriginMatcher): boolean {
  if (matcher === '*') return true;

  if (typeof matcher === 'string') {
    return origin === matcher;
  }
  if (matcher instanceof RegExp) {
    return matcher.test(origin);
  }
  if (Array.isArray(matcher)) {
    return matcher.some((m) => matchOrigin(origin, m));
  }
  return false;
}

