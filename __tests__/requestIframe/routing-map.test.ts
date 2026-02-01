import { requestIframeClient } from '../../src/api/client';
import { requestIframeServer } from '../../src/api/server';
import type { PostMessageData } from '../../src/types';
import { IframeWritableStream } from '../../src/stream';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Routing (path params) / server.map', () => {
  describe('Path parameters', () => {
    it('should extract path parameters from route pattern', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('/api/users/:id', (req, res) => {
        expect(req.params.id).toBe('123');
        expect(req.path).toBe('/api/users/123');
        res.send({ userId: req.params.id });
      });

      const resp = await client.send<any>('/api/users/123');
      expect((resp as any).data.userId).toBe('123');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should extract multiple path parameters', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('/api/users/:userId/posts/:postId', (req, res) => {
        expect(req.params.userId).toBe('456');
        expect(req.params.postId).toBe('789');
        res.send({ userId: req.params.userId, postId: req.params.postId });
      });

      const resp = await client.send<any>('/api/users/456/posts/789');
      expect((resp as any).data.userId).toBe('456');
      expect((resp as any).data.postId).toBe('789');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should return empty params for exact path match', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('/api/users', (req, res) => {
        expect(req.params).toEqual({});
        expect(req.path).toBe('/api/users');
        res.send({ success: true });
      });

      const resp = await client.send<any>('/api/users');
      expect((resp as any).data.success).toBe(true);

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should work with stream requests', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('/api/upload/:fileId', async (req, res) => {
        expect(req.params.fileId).toBe('file-123');
        expect(req.stream).toBeDefined();
        const chunks: any[] = [];
        for await (const chunk of req.stream as any) {
          chunks.push(chunk);
        }
        res.send({ fileId: req.params.fileId, chunks });
      });

      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
          yield 'chunk2';
        }
      });

      const resp = await client.sendStream<any>('/api/upload/file-123', stream);
      expect((resp as any).data.fileId).toBe('file-123');
      expect((resp as any).data.chunks).toEqual(['chunk1', 'chunk2']);

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('server.map', () => {
    it('should register multiple event handlers at once', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const handlers: Record<string, jest.Mock> = {
        'api/getUser': jest.fn(async (req, res) => {
          res.send({ id: req.body.id, name: 'Tom' });
        }),
        'api/saveUser': jest.fn(async (req, res) => {
          res.send({ success: true, saved: req.body });
        })
      };

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      // Use map method to register multiple handlers at once
      server.map(handlers);

      // Send request
      const requestId1 = 'req-1';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId1,
            path: 'api/getUser',
            body: { id: 1 }
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify first handler was called
      expect(handlers['api/getUser']).toHaveBeenCalled();
      const callArgs = handlers['api/getUser'].mock.calls[0];
      expect(callArgs[0].body).toEqual({ id: 1 });
      expect(callArgs[0].path).toBe('api/getUser');
      expect(callArgs[0].requestId).toBe(requestId1);

      // Test second handler
      const requestId2 = 'req-2';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId2,
            path: 'api/saveUser',
            body: { name: 'Alice' }
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlers['api/saveUser']).toHaveBeenCalled();
      const callArgs2 = handlers['api/saveUser'].mock.calls[0];
      expect(callArgs2[0].body).toEqual({ name: 'Alice' });
      expect(callArgs2[0].path).toBe('api/saveUser');
      expect(callArgs2[0].requestId).toBe(requestId2);

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});

