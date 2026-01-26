/**
 * Cookie management utilities
 * Implements browser-like Cookie mechanism
 */

/**
 * Cookie storage item
 */
export interface CookieItem {
  /** Cookie name */
  name: string;
  /** Cookie value */
  value: string;
  /** Path, defaults to '/' */
  path: string;
  /** Expiration time (timestamp) */
  expires?: number;
  /** HttpOnly flag (marker only, no actual effect in postMessage) */
  httpOnly?: boolean;
  /** Secure flag (marker only) */
  secure?: boolean;
  /** SameSite attribute (marker only) */
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Cookie options (for res.cookie)
 */
export interface CookieOptions {
  /** Path, defaults to '/' */
  path?: string;
  /** Expiration date */
  expires?: Date;
  /** Max-Age (seconds) */
  maxAge?: number;
  /** HttpOnly flag */
  httpOnly?: boolean;
  /** Secure flag */
  secure?: boolean;
  /** SameSite attribute */
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Parse Set-Cookie string to CookieItem
 * @param setCookieStr Set-Cookie string, e.g., "token=abc; Path=/; HttpOnly"
 */
export function parseSetCookie(setCookieStr: string): CookieItem | null {
  if (!setCookieStr) return null;

  const parts = setCookieStr.split(';').map(p => p.trim());
  if (parts.length === 0) return null;

  // First part is name=value
  const firstPart = parts[0];
  const eqIndex = firstPart.indexOf('=');
  if (eqIndex === -1) return null;

  const name = firstPart.substring(0, eqIndex).trim();
  const value = firstPart.substring(eqIndex + 1).trim();

  if (!name) return null;

  const cookie: CookieItem = {
    name,
    value,
    path: '/' // Default path
  };

  // Parse other attributes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const attrEqIndex = part.indexOf('=');
    
    if (attrEqIndex === -1) {
      // Attribute without value
      const attrName = part.toLowerCase();
      if (attrName === 'httponly') {
        cookie.httpOnly = true;
      } else if (attrName === 'secure') {
        cookie.secure = true;
      }
    } else {
      // Attribute with value
      const attrName = part.substring(0, attrEqIndex).trim().toLowerCase();
      const attrValue = part.substring(attrEqIndex + 1).trim();

      if (attrName === 'path') {
        cookie.path = attrValue || '/';
      } else if (attrName === 'expires') {
        const date = new Date(attrValue);
        if (!isNaN(date.getTime())) {
          cookie.expires = date.getTime();
        }
      } else if (attrName === 'max-age') {
        const maxAge = parseInt(attrValue, 10);
        if (!isNaN(maxAge)) {
          cookie.expires = Date.now() + maxAge * 1000;
        }
      } else if (attrName === 'samesite') {
        const sameSite = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase();
        if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
          cookie.sameSite = sameSite;
        }
      }
    }
  }

  return cookie;
}

/**
 * Serialize CookieItem to Set-Cookie string
 */
export function serializeSetCookie(cookie: CookieItem): string {
  let str = `${cookie.name}=${cookie.value}`;

  if (cookie.path) {
    str += `; Path=${cookie.path}`;
  }

  if (cookie.expires !== undefined) {
    str += `; Expires=${new Date(cookie.expires).toUTCString()}`;
  }

  if (cookie.httpOnly) {
    str += '; HttpOnly';
  }

  if (cookie.secure) {
    str += '; Secure';
  }

  if (cookie.sameSite) {
    str += `; SameSite=${cookie.sameSite}`;
  }

  return str;
}

/**
 * Create Set-Cookie string from CookieOptions
 */
export function createSetCookie(name: string, value: string, options?: CookieOptions): string {
  let str = `${name}=${value}`;

  const path = options?.path ?? '/';
  str += `; Path=${path}`;

  if (options?.expires) {
    str += `; Expires=${options.expires.toUTCString()}`;
  } else if (options?.maxAge !== undefined) {
    const expires = new Date(Date.now() + options.maxAge * 1000);
    str += `; Expires=${expires.toUTCString()}`;
    str += `; Max-Age=${options.maxAge}`;
  }

  if (options?.httpOnly) {
    str += '; HttpOnly';
  }

  if (options?.secure) {
    str += '; Secure';
  }

  if (options?.sameSite) {
    str += `; SameSite=${options.sameSite}`;
  }

  return str;
}

/**
 * Create Set-Cookie string to delete Cookie
 */
export function createClearCookie(name: string, options?: { path?: string }): string {
  const path = options?.path ?? '/';
  // Set expiration time to past to delete cookie
  return `${name}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}

/**
 * Check if request path matches Cookie's path attribute
 * Implements RFC 6265 path matching algorithm
 * @param requestPath request path, e.g., "/api/users"
 * @param cookiePath Cookie's path attribute, e.g., "/api"
 */
export function matchCookiePath(requestPath: string, cookiePath: string): boolean {
  // Normalize paths
  const reqPath = normalizePath(requestPath);
  const cPath = normalizePath(cookiePath);

  // Exact match
  if (reqPath === cPath) {
    return true;
  }

  // Cookie path is prefix of request path
  if (reqPath.startsWith(cPath)) {
    // Cookie path ends with / or request path has / after cookie path
    if (cPath.endsWith('/') || reqPath.charAt(cPath.length) === '/') {
      return true;
    }
  }

  return false;
}

/**
 * Normalize path
 */
function normalizePath(path: string): string {
  if (!path || path === '') return '/';
  // Ensure starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  // Remove trailing / (unless root path)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Cookie storage manager
 */
export class CookieStore {
  private cookies: Map<string, CookieItem> = new Map();

  /**
   * Generate unique key for Cookie
   */
  private getKey(name: string, path: string): string {
    return `${name}|${path}`;
  }

  /**
   * Set Cookie
   */
  set(cookie: CookieItem): void {
    const key = this.getKey(cookie.name, cookie.path);
    this.cookies.set(key, cookie);
  }

  /**
   * Set Cookie from Set-Cookie string
   */
  setFromSetCookie(setCookieStr: string): void {
    const cookie = parseSetCookie(setCookieStr);
    if (cookie) {
      // Check if this is a delete operation (expiration in the past)
      if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
        this.remove(cookie.name, cookie.path);
      } else {
        this.set(cookie);
      }
    }
  }

  /**
   * Remove Cookie
   */
  remove(name: string, path: string = '/'): void {
    const key = this.getKey(name, path);
    this.cookies.delete(key);
  }

  /**
   * Get all Cookies matching specified path
   * @param requestPath request path
   * @returns matching cookies, format: Record<string, string>
   */
  getForPath(requestPath: string): Record<string, string> {
    const result: Record<string, string> = {};
    const now = Date.now();

    this.cookies.forEach((cookie) => {
      // Check if expired
      if (cookie.expires !== undefined && cookie.expires <= now) {
        return;
      }

      // Check if path matches
      if (matchCookiePath(requestPath, cookie.path)) {
        // If same-name cookie already exists, use the one with longer (more specific) path
        if (result[cookie.name] === undefined) {
          result[cookie.name] = cookie.value;
        }
      }
    });

    return result;
  }

  /**
   * Get Cookie value by name
   * @param name Cookie name
   * @param path path (optional, returns first match if not specified)
   */
  get(name: string, path?: string): string | undefined {
    if (path) {
      const key = this.getKey(name, path);
      const cookie = this.cookies.get(key);
      if (cookie && (!cookie.expires || cookie.expires > Date.now())) {
        return cookie.value;
      }
      return undefined;
    }

    // If path not specified, find all cookies with same name
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name) {
        if (!cookie.expires || cookie.expires > Date.now()) {
          return cookie.value;
        }
      }
    }
    return undefined;
  }

  /**
   * Get all Cookies (with full info)
   */
  getAll(): CookieItem[] {
    const now = Date.now();
    const result: CookieItem[] = [];

    this.cookies.forEach((cookie) => {
      if (!cookie.expires || cookie.expires > now) {
        result.push({ ...cookie });
      }
    });

    return result;
  }

  /**
   * Get all Cookies (simple format)
   */
  getAllSimple(): Record<string, string> {
    const result: Record<string, string> = {};
    const now = Date.now();

    this.cookies.forEach((cookie) => {
      if (!cookie.expires || cookie.expires > now) {
        result[cookie.name] = cookie.value;
      }
    });

    return result;
  }

  /**
   * Clear all Cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Cleanup expired Cookies
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.cookies.forEach((cookie, key) => {
      if (cookie.expires !== undefined && cookie.expires <= now) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cookies.delete(key));
  }
}
