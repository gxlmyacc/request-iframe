import { requestIframeClient } from '../../api/client';
import { requestIframeServer } from '../../api/server';
import { HttpHeader } from '../../constants';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Automatic cookie management', () => {
  describe('Automatic cookie management', () => {
    it('should manually set and get cookies', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      // Initial state should be empty
      expect(client.getCookies()).toEqual({});
      expect(client.getCookie('token')).toBeUndefined();

      // Set cookie (default path '/')
      client.setCookie('token', 'abc123');
      client.setCookie('userId', '42');

      // Get cookie
      expect(client.getCookie('token')).toBe('abc123');
      expect(client.getCookie('userId')).toBe('42');
      expect(client.getCookies()).toEqual({ token: 'abc123', userId: '42' });

      // Remove single cookie
      client.removeCookie('token');
      expect(client.getCookie('token')).toBeUndefined();
      expect(client.getCookie('userId')).toBe('42');

      // Clear all cookies
      client.clearCookies();
      expect(client.getCookies()).toEqual({});

      cleanupIframe(iframe);
    });

    it('should support path-based cookie isolation', () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      // Set cookies with different paths
      client.setCookie('globalToken', 'global_123', { path: '/' });
      client.setCookie('apiToken', 'api_456', { path: '/api' });
      client.setCookie('adminToken', 'admin_789', { path: '/admin' });

      // Get root path cookies - should only include path='/' ones
      expect(client.getCookies('/')).toEqual({ globalToken: 'global_123' });

      // Get /api path cookies - should include '/' and '/api' ones
      expect(client.getCookies('/api')).toEqual({
        globalToken: 'global_123',
        apiToken: 'api_456'
      });

      // Get /api/users path cookies - should include '/' and '/api' ones
      expect(client.getCookies('/api/users')).toEqual({
        globalToken: 'global_123',
        apiToken: 'api_456'
      });

      // Get /admin path cookies - should include '/' and '/admin' ones
      expect(client.getCookies('/admin')).toEqual({
        globalToken: 'global_123',
        adminToken: 'admin_789'
      });

      // Get all cookies
      expect(client.getCookies()).toEqual({
        globalToken: 'global_123',
        apiToken: 'api_456',
        adminToken: 'admin_789'
      });

      cleanupIframe(iframe);
    });

    it('should automatically include set cookies in requests', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      // Pre-set cookies
      client.setCookie('sessionId', 'sess_123');
      client.setCookie('theme', 'dark');

      // Send request (don't wait for response, just check request data)
      client.send('/api/test', { data: 'test' }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify request includes pre-set cookies
      expect(mockContentWindow.postMessage).toHaveBeenCalled();
      const requestCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall).toBeDefined();
      expect(requestCall[0].cookies).toEqual({
        sessionId: 'sess_123',
        theme: 'dark'
      });

      cleanupIframe(iframe);
    });

    it('should override internal cookies with user-provided cookies', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      // Pre-set cookies
      client.setCookie('token', 'old_token');
      client.setCookie('lang', 'en');

      // Pass new token in request
      client
        .send('/api/test', {}, {
          cookies: { token: 'new_token', extra: 'value' }
        })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify user-provided cookies override internal ones
      const requestCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall[0].cookies).toEqual({
        token: 'new_token', // User-provided overrides internal
        lang: 'en', // Internal preserved
        extra: 'value' // User-provided extra
      });

      cleanupIframe(iframe);
    });

    it('should automatically save server-set cookies after response', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      // Mock iframe contentWindow
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      // Server sets cookie
      server.on('/api/login', (req, res) => {
        res.cookie('authToken', 'jwt_xxx');
        res.cookie('refreshToken', 'refresh_yyy');
        res.send({ success: true });
      });

      const requestId = 'test-cookie-req-1';

      // Make request
      const responsePromise = client.send('/api/login', { username: 'test' }, { requestId });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate server receiving request and responding
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId,
            path: '/api/login',
            body: { username: 'test' }
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Wait for response to be sent
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate client receiving response
      const responseCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      if (responseCall && responseCall[0]) {
        // Verify response contains Set-Cookie header
        expect(responseCall[0].headers).toBeDefined();
        expect(responseCall[0].headers[HttpHeader.SET_COOKIE]).toBeDefined();

        window.dispatchEvent(
          new MessageEvent('message', {
            data: responseCall[0],
            origin,
            source: mockContentWindow as any
          })
        );
      }

      // Wait for response to be processed
      await responsePromise;
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify client automatically saved server-set cookies
      expect(client.getCookie('authToken')).toBe('jwt_xxx');
      expect(client.getCookie('refreshToken')).toBe('refresh_yyy');

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});

