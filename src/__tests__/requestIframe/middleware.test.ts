import { requestIframeClient } from '../../api/client';
import { requestIframeServer } from '../../api/server';
import type { PostMessageData } from '../../types';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Middleware', () => {
  describe('Middleware', () => {
    it('should support global middleware', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      requestIframeClient(iframe);
      const server = requestIframeServer();

      // Add middleware (auth validation)
      const middleware = jest.fn((req, res, next) => {
        if (req.headers['authorization'] === 'Bearer token123') {
          next();
        } else {
          res.status(401).send({ error: 'Unauthorized' });
        }
      });

      server.use(middleware);

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Simulate request from iframe to current window (unauthorized)
      const requestId1 = 'req-unauthorized';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId1,
            path: 'test',
            body: {},
            headers: {},
            requireAck: true
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify middleware was called
      expect(middleware).toHaveBeenCalled();

      // Find response (should be 401 or contain Unauthorized)
      const ackCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find(
        (call: any[]) => call[0]?.type === 'ack'
      );
      expect(ackCall).toBeDefined();

      const errorCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find((call: any[]) => {
        const msg = call[0];
        return (msg?.type === 'error' || msg?.type === 'response') && (msg?.status === 401 || msg?.data?.error === 'Unauthorized');
      });
      expect(errorCall).toBeDefined();

      // Test authorized request
      const requestId2 = 'req-authorized';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId2,
            path: 'test',
            body: {},
            headers: { authorization: 'Bearer token123' },
            requireAck: true
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify authorized request succeeded
      const successCall = (mockContentWindow.postMessage as jest.Mock).mock.calls.find(
        (call: any[]) => call[0]?.type === 'response' && call[0]?.status === 200
      );
      expect(successCall).toBeDefined();
      expect(successCall[0].data).toEqual({ result: 'success' });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support path-matching middleware', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      requestIframeClient(iframe);
      const server = requestIframeServer();

      const apiMiddleware = jest.fn((req, res, next) => {
        next();
      });
      const otherMiddleware = jest.fn((req, res, next) => {
        next();
      });

      // Apply middleware only to /api path
      server.use('/api', apiMiddleware);
      server.use('/other', otherMiddleware);

      server.on('api/test', (req, res) => {
        res.send({ result: 'api success' });
      });
      server.on('other/test', (req, res) => {
        res.send({ result: 'other success' });
      });

      // Test /api/test path
      const requestId1 = 'req-api';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId1,
            path: 'api/test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify apiMiddleware was called, otherMiddleware was not
      expect(apiMiddleware).toHaveBeenCalled();
      expect(otherMiddleware).not.toHaveBeenCalled();

      // Test /other/test path
      const requestId2 = 'req-other';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId2,
            path: 'other/test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify otherMiddleware was called
      expect(otherMiddleware).toHaveBeenCalled();

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});

