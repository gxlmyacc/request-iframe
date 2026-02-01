import {
  generateRequestId,
  createPostMessage,
  isValidPostMessage,
  getIframeTargetOrigin,
  parseSetCookie,
  createSetCookie,
  createClearCookie,
  matchCookiePath,
  CookieStore,
  isWindowAvailable
} from '../src/utils';
import {
  validateProtocolVersion,
  validatePostMessage,
  isRequestIframeMessage,
  getProtocolVersion,
  isCompatibleVersion
} from '../src/utils/protocol';
import { matchPath } from '../src/utils/path-match';

describe('utils', () => {
  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
    });
  });

  describe('createPostMessage', () => {
    it('should create correct PostMessage data', () => {
      const before = Date.now();
      const message = createPostMessage('request', 'req123', {
        path: 'test',
        body: { param: 'value' }
      });
      const after = Date.now();

      expect(message).toEqual({
        __requestIframe__: 2,
        timestamp: expect.any(Number),
        type: 'request',
        requestId: 'req123',
        path: 'test',
        body: { param: 'value' }
      });
      
      // Verify timestamp is within valid range
      expect(message.timestamp).toBeGreaterThanOrEqual(before);
      expect(message.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isValidPostMessage', () => {
    it('should validate correct PostMessage data', () => {
      const valid = {
        __requestIframe__: 1,
        type: 'request',
        requestId: 'req123'
      };
      expect(isValidPostMessage(valid)).toBe(true);
    });

    it('should reject invalid PostMessage data', () => {
      expect(isValidPostMessage(null)).toBe(false);
      expect(isValidPostMessage({})).toBe(false);
      expect(isValidPostMessage({ __requestIframe__: 1, type: 'request' })).toBe(false);
      expect(isValidPostMessage({ __requestIframe__: 1, requestId: 'req123' })).toBe(false);
      expect(isValidPostMessage({ type: 'request', requestId: 'req123' })).toBe(false);
    });
  });

  describe('getIframeTargetOrigin', () => {
    beforeEach(() => {
      document.querySelectorAll('iframe').forEach((iframe) => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      });
    });

    it('should parse origin from iframe.src', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com/test.html';
      document.body.appendChild(iframe);

      const origin = getIframeTargetOrigin(iframe);
      expect(origin).toBe('https://example.com');
    });

    it('should return * when iframe has no src', () => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const origin = getIframeTargetOrigin(iframe);
      expect(origin).toBe('*');
    });
  });

  describe('Cookie utilities', () => {
    describe('parseSetCookie', () => {
      it('should parse basic Set-Cookie string', () => {
        const cookie = parseSetCookie('token=abc123');
        expect(cookie).toEqual({
          name: 'token',
          value: 'abc123',
          path: '/'
        });
      });

      it('should parse Set-Cookie string with Path', () => {
        const cookie = parseSetCookie('token=abc123; Path=/api');
        expect(cookie).toEqual({
          name: 'token',
          value: 'abc123',
          path: '/api'
        });
      });

      it('should parse Set-Cookie string with HttpOnly', () => {
        const cookie = parseSetCookie('token=abc123; HttpOnly');
        expect(cookie?.httpOnly).toBe(true);
      });

      it('should parse Set-Cookie string with Secure', () => {
        const cookie = parseSetCookie('token=abc123; Secure');
        expect(cookie?.secure).toBe(true);
      });

      it('should parse Set-Cookie string with Expires', () => {
        const cookie = parseSetCookie('token=abc123; Expires=Thu, 01 Jan 2030 00:00:00 GMT');
        expect(cookie?.expires).toBeDefined();
        expect(cookie?.expires).toBeGreaterThan(Date.now());
      });

      it('should parse Set-Cookie string with Max-Age', () => {
        const cookie = parseSetCookie('token=abc123; Max-Age=3600');
        expect(cookie?.expires).toBeDefined();
        expect(cookie?.expires).toBeGreaterThan(Date.now());
        expect(cookie?.expires).toBeLessThan(Date.now() + 3600 * 1000 + 1000);
      });

      it('should parse Set-Cookie string with SameSite', () => {
        const strict = parseSetCookie('token=abc123; SameSite=Strict');
        expect(strict?.sameSite).toBe('Strict');
        
        const lax = parseSetCookie('token=abc123; SameSite=Lax');
        expect(lax?.sameSite).toBe('Lax');
        
        const none = parseSetCookie('token=abc123; SameSite=None');
        expect(none?.sameSite).toBe('None');
      });
    });

    describe('createSetCookie', () => {
      it('should create basic Set-Cookie string', () => {
        const str = createSetCookie('token', 'abc123');
        expect(str).toBe('token=abc123; Path=/');
      });

      it('should create Set-Cookie string with Path', () => {
        const str = createSetCookie('token', 'abc123', { path: '/api' });
        expect(str).toBe('token=abc123; Path=/api');
      });

      it('should create Set-Cookie string with HttpOnly', () => {
        const str = createSetCookie('token', 'abc123', { httpOnly: true });
        expect(str).toContain('HttpOnly');
      });
    });

    describe('createClearCookie', () => {
      it('should create Set-Cookie string to delete cookie', () => {
        const str = createClearCookie('token');
        expect(str).toContain('token=');
        expect(str).toContain('Max-Age=0');
        expect(str).toContain('Expires=');
      });
    });

    describe('matchCookiePath', () => {
      it('should return true for exact match', () => {
        expect(matchCookiePath('/api', '/api')).toBe(true);
        expect(matchCookiePath('/', '/')).toBe(true);
      });

      it('should return true when request path is sub-path of cookie path', () => {
        expect(matchCookiePath('/api/users', '/api')).toBe(true);
        expect(matchCookiePath('/api/users/123', '/api')).toBe(true);
        expect(matchCookiePath('/api/users', '/')).toBe(true);
      });

      it('should return false for non-matching paths', () => {
        expect(matchCookiePath('/api', '/admin')).toBe(false);
        expect(matchCookiePath('/ap', '/api')).toBe(false);
        expect(matchCookiePath('/apitest', '/api')).toBe(false);
      });
    });

    describe('CookieStore', () => {
      let store: CookieStore;

      beforeEach(() => {
        store = new CookieStore();
      });

      it('should set and get cookie', () => {
        store.set({ name: 'token', value: 'abc', path: '/' });
        expect(store.get('token')).toBe('abc');
      });

      it('should get cookies by path', () => {
        store.set({ name: 'global', value: 'g', path: '/' });
        store.set({ name: 'api', value: 'a', path: '/api' });
        store.set({ name: 'admin', value: 'ad', path: '/admin' });

        expect(store.getForPath('/')).toEqual({ global: 'g' });
        expect(store.getForPath('/api')).toEqual({ global: 'g', api: 'a' });
        expect(store.getForPath('/api/users')).toEqual({ global: 'g', api: 'a' });
        expect(store.getForPath('/admin')).toEqual({ global: 'g', admin: 'ad' });
      });

      it('should remove cookie', () => {
        store.set({ name: 'token', value: 'abc', path: '/' });
        store.remove('token', '/');
        expect(store.get('token')).toBeUndefined();
      });

      it('should set cookie from Set-Cookie string', () => {
        store.setFromSetCookie('token=abc123; Path=/api');
        expect(store.get('token', '/api')).toBe('abc123');
      });

      it('should remove expired cookie from Set-Cookie string', () => {
        store.set({ name: 'token', value: 'old', path: '/' });
        store.setFromSetCookie('token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        expect(store.get('token', '/')).toBeUndefined();
      });

      it('should clear all cookies', () => {
        store.set({ name: 'a', value: '1', path: '/' });
        store.set({ name: 'b', value: '2', path: '/api' });
        store.clear();
        expect(store.getAllSimple()).toEqual({});
      });

      it('should handle expired cookies in getForPath', () => {
        store.set({ name: 'expired', value: 'old', path: '/', expires: Date.now() - 1000 });
        expect(store.getForPath('/')).toEqual({});
      });

      it('should handle getAll method', () => {
        store.set({ name: 'a', value: '1', path: '/' });
        store.set({ name: 'b', value: '2', path: '/api' });
        const all = store.getAll();
        expect(all.length).toBe(2);
        expect(all.some(c => c.name === 'a')).toBe(true);
        expect(all.some(c => c.name === 'b')).toBe(true);
      });

      it('should handle cleanup method', () => {
        store.set({ name: 'expired', value: 'old', path: '/', expires: Date.now() - 1000 });
        store.set({ name: 'valid', value: 'new', path: '/' });
        store.cleanup();
        expect(store.get('expired')).toBeUndefined();
        expect(store.get('valid')).toBe('new');
      });
    });
  });

  describe('Protocol utilities', () => {
    describe('validateProtocolVersion', () => {
      it('should validate compatible version', () => {
        const result = validateProtocolVersion(1);
        expect(result.valid).toBe(true);
        expect(result.version).toBe(1);
      });

      it('should reject version too low', () => {
        const result = validateProtocolVersion(0);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('VERSION_TOO_LOW');
      });

      it('should reject invalid format', () => {
        const result1 = validateProtocolVersion('1' as any);
        expect(result1.valid).toBe(false);
        expect(result1.errorCode).toBe('INVALID_FORMAT');

        const result2 = validateProtocolVersion(1.5);
        expect(result2.valid).toBe(false);
        expect(result2.errorCode).toBe('INVALID_FORMAT');
      });
    });

    describe('validatePostMessage', () => {
      it('should validate correct message', () => {
        const result = validatePostMessage({
          __requestIframe__: 1,
          type: 'request',
          requestId: 'req123'
        });
        expect(result.valid).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should reject non-object', () => {
        const result = validatePostMessage(null);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_FORMAT');
      });

      it('should reject missing protocol identifier', () => {
        const result = validatePostMessage({
          type: 'request',
          requestId: 'req123'
        });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_FORMAT');
      });

      it('should reject missing type', () => {
        const result = validatePostMessage({
          __requestIframe__: 1,
          requestId: 'req123'
        });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_FORMAT');
      });

      it('should reject missing requestId', () => {
        const result = validatePostMessage({
          __requestIframe__: 1,
          type: 'request'
        });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_FORMAT');
      });
    });

    describe('isRequestIframeMessage', () => {
      it('should return true for valid message', () => {
        expect(isRequestIframeMessage({
          __requestIframe__: 1,
          type: 'request',
          requestId: 'req123'
        })).toBe(true);
      });

      it('should return false for invalid message', () => {
        expect(isRequestIframeMessage(null)).toBe(false);
        expect(isRequestIframeMessage({})).toBe(false);
        expect(isRequestIframeMessage({
          __requestIframe__: '1',
          type: 'request',
          requestId: 'req123'
        })).toBe(false);
      });
    });

    describe('getProtocolVersion', () => {
      it('should extract version from message', () => {
        expect(getProtocolVersion({
          __requestIframe__: 1
        })).toBe(1);
      });

      it('should return undefined for invalid message', () => {
        expect(getProtocolVersion(null)).toBeUndefined();
        expect(getProtocolVersion({})).toBeUndefined();
        expect(getProtocolVersion({
          __requestIframe__: '1'
        })).toBeUndefined();
      });
    });

    describe('isCompatibleVersion', () => {
      it('should return true for compatible version', () => {
        expect(isCompatibleVersion(1)).toBe(true);
        expect(isCompatibleVersion(2)).toBe(true);
      });

      it('should return false for incompatible version', () => {
        expect(isCompatibleVersion(0)).toBe(false);
      });
    });
  });

  describe('Path matching', () => {
    describe('matchPath', () => {
      it('should match exact string path', () => {
        expect(matchPath('/api', '/api')).toBe(true);
        expect(matchPath('/api/users', '/api/users')).toBe(true);
      });

      it('should match prefix path', () => {
        expect(matchPath('/api/users', '/api')).toBe(true);
        expect(matchPath('/api/users/123', '/api')).toBe(true);
      });

      it('should not match non-prefix path', () => {
        expect(matchPath('/api2', '/api')).toBe(false);
        expect(matchPath('/apitest', '/api')).toBe(false);
      });

      it('should match with trailing slash', () => {
        expect(matchPath('/api/users', '/api/')).toBe(true);
      });

      it('should match RegExp', () => {
        expect(matchPath('/api/users/123', /^\/api\/users\/\d+$/)).toBe(true);
        expect(matchPath('/api/users/abc', /^\/api\/users\/\d+$/)).toBe(false);
      });

      it('should match array of matchers', () => {
        expect(matchPath('/api/users', ['/admin', '/api'])).toBe(true);
        expect(matchPath('/api/users', ['/admin', '/other'])).toBe(false);
      });

      it('should match wildcard patterns', () => {
        expect(matchPath('/api/users/123', '/api/*')).toBe(true);
        expect(matchPath('/api/users', '/api/*')).toBe(true);
        expect(matchPath('/api/users/123/posts', '/api/*/posts')).toBe(true);
        expect(matchPath('/other/users', '/api/*')).toBe(false);
      });

      it('should normalize paths', () => {
        expect(matchPath('api', '/api')).toBe(true);
        expect(matchPath('/api', 'api')).toBe(true);
      });
    });
  });

  describe('isWindowAvailable', () => {
    it('should return true for valid window', () => {
      expect(isWindowAvailable(window)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isWindowAvailable(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWindowAvailable(undefined)).toBe(false);
    });

    it('should return false for closed window (window.open)', () => {
      const mockWindow = {
        closed: true,
        document: {},
        postMessage: jest.fn()
      } as any;
      expect(isWindowAvailable(mockWindow)).toBe(false);
    });

    it('should return true for open window (window.open)', () => {
      const mockWindow = {
        closed: false,
        document: {},
        postMessage: jest.fn()
      } as any;
      expect(isWindowAvailable(mockWindow)).toBe(true);
    });

    it('should return false when postMessage is missing', () => {
      const mockWindow = {
        closed: false
      } as any;
      expect(isWindowAvailable(mockWindow)).toBe(false);
    });
  });
});
