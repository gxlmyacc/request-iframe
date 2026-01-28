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

    // Support parameter patterns (e.g., '/api/users/:id')
    if (matcher.includes(':')) {
      return matchPathWithParams(normalizedPath, normalizedMatcher).match;
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

/**
 * Path match result with extracted parameters
 */
export interface PathMatchResult {
  /** Whether the path matches */
  match: boolean;
  /** Extracted path parameters (e.g., { id: '123' } for '/api/users/:id' and '/api/users/123') */
  params: Record<string, string>;
}

/**
 * Match path with parameter extraction (supports :param syntax like Express)
 * @param path request path
 * @param pattern path pattern with parameters (e.g., '/api/users/:id')
 * @returns match result with extracted parameters
 */
export function matchPathWithParams(path: string, pattern: string): PathMatchResult {
  // Normalize paths
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;

  // Check if pattern contains parameters (:param)
  if (!normalizedPattern.includes(':')) {
    // No parameters, use exact match
    return {
      match: normalizedPath === normalizedPattern,
      params: {}
    };
  }

  // Extract parameter names from pattern
  const paramNames: string[] = [];
  const paramRegex = /:([^/]+)/g;
  let match;
  while ((match = paramRegex.exec(normalizedPattern)) !== null) {
    paramNames.push(match[1]);
  }

  // Convert pattern to regex, replacing :param with capture groups
  // '/api/users/:id' -> '^/api/users/([^/]+)$'
  // '/api/users/:id/posts/:postId' -> '^/api/users/([^/]+)/posts/([^/]+)$'
  const regexPattern = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special characters
    .replace(/:[^/]+/g, '([^/]+)'); // Replace :param with capture group

  const regex = new RegExp(`^${regexPattern}$`);
  const regexMatch = regex.exec(normalizedPath);

  if (!regexMatch) {
    return {
      match: false,
      params: {}
    };
  }

  // Extract parameter values from match groups
  const params: Record<string, string> = {};
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]] = regexMatch[i + 1];
  }

  return {
    match: true,
    params
  };
}
