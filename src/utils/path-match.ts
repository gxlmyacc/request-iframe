/**
 * Path matcher type
 */
export type PathMatcher = string | RegExp | PathPattern | Array<string | RegExp | PathPattern>;

/**
 * Path pattern (supports wildcards)
 * Example: '/api/*' matches all paths starting with '/api/'
 */
export type PathPattern = string;

/**
 * Check if path matches the given matcher
 * @param path request path
 * @param matcher path matcher (string, RegExp, PathPattern, or array)
 * @returns whether matches
 */
export function matchPath(path: string, matcher: PathMatcher): boolean {
  // Normalize path (ensure starts with /)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // If array, match if any one matches
  if (Array.isArray(matcher)) {
    return matcher.some((m) => matchPath(normalizedPath, m));
  }

  // If RegExp
  if (matcher instanceof RegExp) {
    return matcher.test(normalizedPath);
  }

  // If string
  if (typeof matcher === 'string') {
    // Exact match
    if (normalizedPath === matcher) {
      return true;
    }

    // Normalize matcher (ensure starts with /)
    const normalizedMatcher = matcher.startsWith('/') ? matcher : `/${matcher}`;

    // Prefix match
    if (normalizedPath.startsWith(normalizedMatcher)) {
      // If matcher is '/api', path is '/api', match
      // If matcher is '/api', path is '/api/users', match
      // If matcher is '/api/', path is '/api/users', match
      // If matcher is '/api', path is '/api2', no match
      if (normalizedMatcher.endsWith('/')) {
        return true;
      }
      // If matcher doesn't end with /, ensure path has / or ends after matcher
      const nextChar = normalizedPath[normalizedMatcher.length];
      return nextChar === undefined || nextChar === '/';
    }

    // Support wildcard patterns (e.g., '/api/*')
    if (matcher.includes('*')) {
      return matchPattern(normalizedPath, normalizedMatcher);
    }

    return false;
  }

  return false;
}

/**
 * Match path pattern (supports wildcards)
 * @param path request path
 * @param pattern path pattern (e.g., '/api/*')
 */
function matchPattern(path: string, pattern: string): boolean {
  // Convert pattern to regex
  // '/api/*' -> '^/api/.*$'
  // '/api/*/users' -> '^/api/.*/users$'
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special characters
    .replace(/\*/g, '.*'); // Replace * with .*
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}
