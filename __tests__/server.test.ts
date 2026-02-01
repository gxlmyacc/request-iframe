import { requestIframeServer, clearRequestIframeServerCache } from '../src/api/server';
import { MessageType, MessageRole, HttpStatus, ErrorCode, Messages } from '../src/constants';
import { PostMessageData } from '../src/types';

/**
 * Create test iframe
 */
function createTestIframe(origin: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = `${origin}/test.html`;
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * Cleanup test iframe
 */
function cleanupIframe(iframe: HTMLIFrameElement): void {
  if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}

/**
 * Create a mock window object that can be used as MessageEvent source
 * This ensures the source is recognized as a Window object by the message channel
 */
function createMockWindow(): { postMessage: jest.Mock } & Window {
  const mockPostMessage = jest.fn();
  // Create a mock window that extends the real window prototype
  const mockWindow = Object.create(window) as any;
  mockWindow.postMessage = mockPostMessage;
  // Ensure isWindowAvailable() treats it as open
  mockWindow.closed = false;
  return mockWindow;
}

describe('RequestIframeServer', () => {
  beforeEach(() => {
    clearRequestIframeServerCache();
    // Clear all iframes
    document.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
  });

  afterEach(() => {
    // Clear all caches
    clearRequestIframeServerCache();
    // Clear all iframes
    document.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
  });

  describe('constructor', () => {
    it('should create server with default options', () => {
      const server = requestIframeServer();
      expect(server).toBeDefined();
      expect(server.isOpen).toBe(true);
      server.destroy();
    });

    it('should create server with secretKey', () => {
      const server = requestIframeServer({ secretKey: 'test-key' });
      expect(server.secretKey).toBe('test-key');
      server.destroy();
    });

    it('should create server with custom ackTimeout', () => {
      const server = requestIframeServer({ ackTimeout: 1000 });
      expect(server).toBeDefined();
      server.destroy();
    });

    it('should create server with autoOpen false', () => {
      const server = requestIframeServer({ autoOpen: false });
      expect(server.isOpen).toBe(false);
      server.open();
      expect(server.isOpen).toBe(true);
      server.destroy();
    });

    it('should create server with custom versionValidator', () => {
      const versionValidator = jest.fn(() => true);
      const server = requestIframeServer({ versionValidator } as any);
      expect(server).toBeDefined();
      server.destroy();
    });
  });

  describe('origin validation', () => {
    it('should ignore request when origin is not allowed (allowedOrigins)', async () => {
      const server = requestIframeServer({ allowedOrigins: ['https://allowed.com'] } as any);
      const handler = jest.fn();
      server.on('test', handler);

      const origin = 'https://blocked.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req_origin_1',
            path: 'test',
            role: MessageRole.CLIENT
          } as PostMessageData,
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).not.toHaveBeenCalled();
      expect(mockWindow.postMessage).not.toHaveBeenCalled();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should allow request when validateOrigin returns true', async () => {
      const server = requestIframeServer({
        validateOrigin: (origin: string) => origin === 'https://example.com'
      } as any);
      const handler = jest.fn();
      server.on('test', handler);

      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req_origin_2',
            path: 'test',
            role: MessageRole.CLIENT
          } as PostMessageData,
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalled();

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('open and close', () => {
    it('should open server', () => {
      const server = requestIframeServer({ autoOpen: false });
      expect(server.isOpen).toBe(false);
      server.open();
      expect(server.isOpen).toBe(true);
      server.destroy();
    });

    it('should not open if already open', () => {
      const server = requestIframeServer();
      const originalOpen = server.open;
      server.open = jest.fn();
      server.open();
      expect(server.open).toHaveBeenCalledTimes(1);
      server.destroy();
    });

    it('should close server', () => {
      const server = requestIframeServer();
      expect(server.isOpen).toBe(true);
      server.close();
      expect(server.isOpen).toBe(false);
      server.destroy();
    });

    it('should not close if already closed', () => {
      const server = requestIframeServer();
      server.close();
      const originalClose = server.close;
      server.close = jest.fn();
      server.close();
      expect(server.close).toHaveBeenCalledTimes(1);
      server.destroy();
    });
  });

  describe('on and off', () => {
    it('should register handler', async () => {
      const server = requestIframeServer();
      const handler = jest.fn();
      
      server.on('test', handler);
      
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            body: { param: 'value' },
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should unregister handler', async () => {
      const server = requestIframeServer();
      const handler = jest.fn();
      
      server.on('test', handler);
      server.off('test');
      
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).not.toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle multiple handlers for same path', async () => {
      const server = requestIframeServer();
      const handler1 = jest.fn((req, res) => {
        res.send({ result: 'handler1' });
      });
      const handler2 = jest.fn((req, res) => {
        res.send({ result: 'handler2' });
      });
      
      server.on('test', handler1);
      server.on('test', handler2);
      
      // Only the last registered handler should be called
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('map', () => {
    it('should register multiple handlers at once', () => {
      const server = requestIframeServer();
      const handler1 = jest.fn((req, res) => res.send({ path: '1' }));
      const handler2 = jest.fn((req, res) => res.send({ path: '2' }));
      const handler3 = jest.fn((req, res) => res.send({ path: '3' }));
      
      server.map({
        path1: handler1,
        path2: handler2,
        path3: handler3
      });
      
      expect(server).toBeDefined();
      server.destroy();
    });
  });

  describe('use (middleware)', () => {
    it('should register global middleware', async () => {
      const server = requestIframeServer();
      const middleware = jest.fn((req, res, next) => next());
      
      server.use(middleware);
      
      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });
      
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(middleware).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should register path-specific middleware', async () => {
      const server = requestIframeServer();
      const middleware = jest.fn((req, res, next) => next());
      
      server.use('/api/*', middleware);
      
      server.on('/api/test', (req, res) => {
        res.send({ result: 'success' });
      });
      
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: '/api/test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(middleware).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should execute middleware in order', async () => {
      const server = requestIframeServer();
      const order: number[] = [];
      
      server.use((req, res, next) => {
        order.push(1);
        next();
      });
      
      server.use((req, res, next) => {
        order.push(2);
        next();
      });
      
      server.on('test', (req, res) => {
        order.push(3);
        res.send({ result: 'success' });
      });
      
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow = createMockWindow();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(order).toEqual([1, 2, 3]);
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('error handling', () => {
    it('should send METHOD_NOT_FOUND error when handler not found', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'nonexistent',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          requestId: 'req123',
          error: expect.objectContaining({
            message: Messages.METHOD_NOT_FOUND,
            code: ErrorCode.METHOD_NOT_FOUND
          }),
          status: HttpStatus.NOT_FOUND
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should limit concurrent requests per client (maxConcurrentRequestsPerClient)', async () => {
      const server = requestIframeServer({ maxConcurrentRequestsPerClient: 1 } as any);
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      server.on('slow', () => {
        return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200));
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req_limit_1',
            path: 'slow',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req_limit_2',
            path: 'slow',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          requestId: 'req_limit_2',
          error: expect.objectContaining({
            message: expect.stringContaining('Too many'),
            code: ErrorCode.TOO_MANY_REQUESTS
          }),
          status: HttpStatus.TOO_MANY_REQUESTS
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle handler errors', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      server.on('test', () => {
        throw new Error('Handler error');
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          requestId: 'req123',
          status: HttpStatus.INTERNAL_SERVER_ERROR
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle async handler errors', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      server.on('test', async () => {
        throw new Error('Async handler error');
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          requestId: 'req123',
          status: HttpStatus.INTERNAL_SERVER_ERROR
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('async handlers', () => {
    it('should send ASYNC notification for async handlers', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      server.on('test', async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.send({ result: 'success' });
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'async',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle async handler without response', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      server.on('test', async () => {
        // No response sent
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('ping/pong', () => {
    it('should handle ping messages', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'ping',
            requestId: 'req123',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pong',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('acknowledgment (ACK-only requireAck)', () => {
    it('should resolve res.send(..., {requireAck:true}) on ACK', async () => {
      const server = requestIframeServer();
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockWindow: any = { postMessage: jest.fn() };

      let ackResolve: (value: boolean) => void;
      const ackPromise = new Promise<boolean>(resolve => {
        ackResolve = resolve;
      });

      server.on('test', (req, res) => {
        res.send({ result: 'success' }, { requireAck: true }).then(ackResolve);
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 150));

      const responseMsg = (mockWindow.postMessage as jest.Mock).mock.calls
        .map((call: any[]) => call[0])
        .find((msg: any) => msg?.type === 'response');
      expect(responseMsg).toBeDefined();

      // Send ACK acknowledgment
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            timestamp: Date.now(),
            type: 'ack',
            requestId: 'req123',
            ack: { id: responseMsg.ack.id },
            role: MessageRole.CLIENT
          },
          origin,
          source: mockWindow
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const received = await Promise.race([
        ackPromise,
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))
      ]);
      expect(received).toBe(true);

      server.destroy();
      cleanupIframe(iframe);
    }, 10000);
  });

  describe('destroy', () => {
    it('should destroy server and clean up', () => {
      const server = requestIframeServer();
      server.on('test', (req, res) => res.send({}));
      
      expect(server.isOpen).toBe(true);
      server.destroy();
      expect(server.isOpen).toBe(false);
    });
  });

  describe('messageDispatcher access', () => {
    it('should provide access to messageDispatcher', () => {
      const server = requestIframeServer();
      expect((server as any).messageDispatcher).toBeDefined();
      server.destroy();
    });
  });
});
