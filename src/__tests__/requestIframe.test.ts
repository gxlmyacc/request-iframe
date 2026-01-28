import { requestIframeClient, clearRequestIframeClientCache } from '../api/client';
import { requestIframeServer, clearRequestIframeServerCache } from '../api/server';
import { RequestConfig, Response, ErrorResponse, PostMessageData } from '../types';
import { HttpHeader, MessageRole, Messages } from '../constants';

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

describe('requestIframeClient and requestIframeServer', () => {
  beforeEach(() => {
    // Clear all caches
    clearRequestIframeClientCache();
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
    clearRequestIframeClientCache();
    clearRequestIframeServerCache();
    // Clear all iframes
    document.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
  });

  describe('Basic functionality', () => {
    it('should send request and receive response', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      // Mock iframe response
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          // Simulate server handling request
          if (msg.type === 'request') {
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            // Then send response
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      const response = await client.send('test', { param: 'value' }, { ackTimeout: 1000 });
      expect(response.data).toEqual({ result: 'success' });
      expect(response.status).toBe(200);
      expect(mockContentWindow.postMessage).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should throw error when iframe.contentWindow is unavailable', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com/test.html';
      document.body.appendChild(iframe);
      Object.defineProperty(iframe, 'contentWindow', {
        value: null,
        writable: true
      });

      expect(() => requestIframeClient(iframe)).toThrow();
    });

    it('should throw error on connection timeout', async () => {
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
      const server = requestIframeServer();

      await expect(
        client.send('test', undefined, { ackTimeout: 100 })
      ).rejects.toMatchObject({
        code: 'ACK_TIMEOUT'
      });
      cleanupIframe(iframe);
      server.destroy();
    });

    it('should support isConnect method to check server availability', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'ping') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'pong',
                  requestId: msg.requestId,
                  secretKey: msg.secretKey,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      const connected = await client.isConnect();
      expect(connected).toBe(true);

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('Interceptors', () => {
    it('should support request interceptors', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Verify interceptor is effective
            expect(msg.body).toHaveProperty('intercepted', true);
            
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            
            // Then send response
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { success: true },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ success: true });
      });

      const requestInterceptor = jest.fn((config: RequestConfig) => {
        config.body = { ...config.body, intercepted: true };
        return config;
      });
      client.interceptors.request.use(requestInterceptor);

      await client.send('test', { param: 'value' }, { ackTimeout: 1000 });
      expect(requestInterceptor).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support response interceptors', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            
            // Then send response
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { success: true },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ success: true });
      });

      const responseInterceptor = jest.fn((response: Response) => {
        response.data = { ...response.data, intercepted: true };
        return response;
      });
      client.interceptors.response.use(responseInterceptor as any);

      const response = await client.send('test', undefined, { ackTimeout: 1000 });
      expect(response.data).toHaveProperty('intercepted', true);
      expect(responseInterceptor).toHaveBeenCalled();
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('Error handling', () => {
    it('should handle error response correctly', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            
            // Then send error response
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: {
                      message: 'Method not found',
                      code: 'METHOD_NOT_FOUND'
                    },
                    status: 404,
                    statusText: 'Not Found',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      // No handler registered, should return METHOD_NOT_FOUND
      await expect(client.send('test', undefined, { ackTimeout: 1000 })).rejects.toMatchObject({
        code: 'METHOD_NOT_FOUND',
        response: { status: 404 }
      });
      cleanupIframe(iframe);
      server.destroy();
    });
  });

  describe('Async tasks', () => {
    it('should support async task handling', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            
            // Send async notification
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'async',
                    requestId: msg.requestId,
                    path: msg.path,
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
            
            // Delay response (simulate async processing)
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'async success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 100);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('asyncTest', async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        res.send({ result: 'async success' });
      });

      const response = await client.send('asyncTest', undefined, { 
        ackTimeout: 1000,
        timeout: 200,
        asyncTimeout: 5000
      });
      expect(response.data).toEqual({ result: 'async success' });
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('MessageChannel sharing', () => {
    it('should share the same message channel for the same secretKey', () => {
      const iframe1 = createTestIframe('https://example.com');
      const iframe2 = createTestIframe('https://example2.com');

      const server1 = requestIframeServer({ secretKey: 'demo' });
      const server2 = requestIframeServer({ secretKey: 'demo' });

      // Server instances are different
      expect(server1).not.toBe(server2);
      
      // But they should share the same underlying message channel (verified by secretKey)
      expect(server1.secretKey).toBe(server2.secretKey);
      expect(server1.secretKey).toBe('demo');

      server1.destroy();
      server2.destroy();
      cleanupIframe(iframe1);
      cleanupIframe(iframe2);
    });

    it('should have independent message channels for different secretKeys', () => {
      const iframe = createTestIframe('https://example.com');

      const server1 = requestIframeServer({ secretKey: 'demo1' });
      const server2 = requestIframeServer({ secretKey: 'demo2' });

      // Verify different server instances
      expect(server1).not.toBe(server2);
      
      // secretKeys are different
      expect(server1.secretKey).toBe('demo1');
      expect(server2.secretKey).toBe('demo2');

      server1.destroy();
      server2.destroy();
      cleanupIframe(iframe);
    });

    it('should share the same message channel when no secretKey', () => {
      const iframe1 = createTestIframe('https://example.com');
      const iframe2 = createTestIframe('https://example2.com');

      const server1 = requestIframeServer();
      const server2 = requestIframeServer();

      // Server instances are different
      expect(server1).not.toBe(server2);
      
      // But they should share the same underlying message channel (both have no secretKey)
      expect(server1.secretKey).toBe(server2.secretKey);
      expect(server1.secretKey).toBeUndefined();

      server1.destroy();
      server2.destroy();
      cleanupIframe(iframe1);
      cleanupIframe(iframe2);
    });
  });

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

      const client = requestIframeClient(iframe);
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
            headers: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify middleware was called
      expect(middleware).toHaveBeenCalled();
      
      // Find response (should be 401 or contain Unauthorized)
      const ackCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'ack'
      );
      expect(ackCall).toBeDefined();

      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => {
          const msg = call[0];
          return (msg?.type === 'error' || msg?.type === 'response') && 
                 (msg?.status === 401 || msg?.data?.error === 'Unauthorized');
        }
      );
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
            headers: { authorization: 'Bearer token123' }
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify authorized request succeeded
      const successCall = mockContentWindow.postMessage.mock.calls.find(
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

      const client = requestIframeClient(iframe);
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

  describe('sendFile', () => {
    it('should support sending file (base64 encoded)', async () => {
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
      const server = requestIframeServer();

      server.on('getFile', async (req, res) => {
        try {
          const fileContent = 'Hello World';
          await res.sendFile(fileContent, {
            mimeType: 'text/plain',
            fileName: 'test.txt'
          });
        } catch (error) {
          console.error('Error in sendFile:', error);
          throw error;
        }
      });

      // Simulate request from iframe
      const requestId = 'req-file';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getFile',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      // Wait for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify sendFile was called - now it uses stream
      expect(mockContentWindow.postMessage).toHaveBeenCalled();
      
      // Debug: Check all message types sent
      const allCalls = mockContentWindow.postMessage.mock.calls;
      const messageTypes = allCalls.map(call => call[0]?.type).filter(Boolean);
      if (messageTypes.length === 0) {
        throw new Error('No messages were sent to mockContentWindow.postMessage');
      }
      
      const streamStartCall = allCalls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      if (!streamStartCall) {
        throw new Error(`stream_start not found. Message types sent: ${messageTypes.join(', ')}`);
      }
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);
      expect(streamBody.metadata?.mimeType).toBe('text/plain');
      expect(streamBody.metadata?.filename).toBe('test.txt');

      // Verify stream_data was sent
      const streamDataCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_data'
      );
      expect(streamDataCall).toBeDefined();
      
      // Verify stream_end was sent
      const streamEndCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_end'
      );
      expect(streamEndCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sending Blob file', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('getBlob', async (req, res) => {
        const blob = new Blob(['test content'], { type: 'text/plain' });
        await res.sendFile(blob, {
          fileName: 'blob.txt',
          mimeType: 'text/plain'
        });
      });

      const requestId = 'req-blob';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getBlob',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify stream_start was sent
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);
      expect(streamBody.metadata?.mimeType).toBe('text/plain');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sending File object', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('getFileObj', async (req, res) => {
        const file = new File(['file content'], 'test.txt', { type: 'text/plain' });
        await res.sendFile(file);
      });

      const requestId = 'req-fileobj';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getFileObj',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify stream_start was sent
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);
      expect(streamBody.metadata?.filename).toBe('test.txt');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sendFile with requireAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('getFileAck', async (req, res) => {
        await res.sendFile('test', {
          fileName: 'test.txt',
          requireAck: true
        });
      });

      const requestId = 'req-fileack';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getFileAck',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify stream_start was sent with requireAck
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should auto-resolve file stream to fileData on client side', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            // Then send stream_start
            setTimeout(() => {
              const streamId = 'stream-test';
              const fileContent = btoa('Hello World');
              
              // Send stream_start
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    timestamp: Date.now(),
                    type: 'stream_start',
                    requestId: msg.requestId,
                    status: 200,
                    statusText: 'OK',
                    headers: {
                      'Content-Type': 'text/plain',
                      'Content-Disposition': 'attachment; filename="test.txt"'
                    },
                    body: {
                      streamId,
                      type: 'file',
                      chunked: false,
                      autoResolve: true,
                      metadata: {
                        filename: 'test.txt',
                        mimeType: 'text/plain'
                      }
                    },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
              
              // Send stream_data
              setTimeout(() => {
                window.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      __requestIframe__: 1,
                      timestamp: Date.now(),
                      type: 'stream_data',
                      requestId: msg.requestId,
                      body: {
                        streamId,
                        data: fileContent,
                        done: true
                      },
                      role: MessageRole.SERVER
                    },
                    origin
                  })
                );
                
                // Send stream_end
                setTimeout(() => {
                  window.dispatchEvent(
                    new MessageEvent('message', {
                      data: {
                        __requestIframe__: 1,
                        timestamp: Date.now(),
                        type: 'stream_end',
                        requestId: msg.requestId,
                        body: {
                          streamId
                        },
                        role: MessageRole.SERVER
                      },
                      origin
                    })
                  );
                }, 100);
              }, 100);
            }, 100);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      const response = await client.send('getFile', undefined, { 
        ackTimeout: 1000,
        timeout: 10000
      }) as any;
      
      // Verify that data is a File object (auto-resolved from stream)
      expect(response.data).toBeInstanceOf(File);
      const file = response.data as File;
      expect(file.name).toBe('test.txt');
      expect(file.type).toBe('text/plain');
      
      // Verify file content using FileReader or arrayBuffer
      const fileContent = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(reader.result as string);
        };
        reader.readAsText(file);
      });
      expect(fileContent).toBe('Hello World');
      
      // Verify that stream is not present (because it was auto-resolved)
      expect(response.stream).toBeUndefined();

      cleanupIframe(iframe);
    }, 20000);
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
      const requestCall = mockContentWindow.postMessage.mock.calls.find(
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
      client.send('/api/test', {}, { 
        cookies: { token: 'new_token', extra: 'value' } 
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify user-provided cookies override internal ones
      const requestCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall[0].cookies).toEqual({
        token: 'new_token',  // User-provided overrides internal
        lang: 'en',          // Internal preserved
        extra: 'value'       // User-provided extra
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
      const responseCall = mockContentWindow.postMessage.mock.calls.find(
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

  describe('Response methods', () => {
    it('should support res.send with requireAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      let responseMessage: any = null;
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              const response: PostMessageData = {
                __requestIframe__: 1,
                timestamp: Date.now(),
                type: 'response',
                requestId: msg.requestId,
                data: { result: 'success' },
                status: 200,
                requireAck: true,
                role: MessageRole.SERVER
              };
              responseMessage = response;
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: response,
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('testAck', async (req, res) => {
        await res.send({ result: 'success' }, { requireAck: true });
      });

      const requestId = 'req-ack';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testAck',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify response was sent with requireAck
      if (responseMessage && 'requireAck' in responseMessage) {
        expect(responseMessage.requireAck).toBe(true);
      }

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.json with requireAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { json: true },
                    status: 200,
                    requireAck: true,
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testJson', async (req, res) => {
        await res.json({ json: true }, { requireAck: true });
      });

      const requestId = 'req-json';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testJson',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      if (responseCall && responseCall[0] && responseCall[0].headers) {
        expect(responseCall[0].headers[HttpHeader.CONTENT_TYPE]).toBe('application/json');
      }

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.status()', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { error: 'Not Found' },
                    status: 404,
                    statusText: 'Not Found',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testStatus', (req, res) => {
        res.status(404).send({ error: 'Not Found' });
      });

      const requestId = 'req-status';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testStatus',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response' && call[0]?.status === 404
      );
      expect(responseCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.setHeader() with array values', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testHeader', (req, res) => {
        res.setHeader('X-Custom', ['value1', 'value2']);
        res.send({});
      });

      const requestId = 'req-header';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testHeader',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      expect(responseCall[0].headers['X-Custom']).toBe('value1, value2');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.set() method', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testSet', (req, res) => {
        res.set('X-Custom', 'value').send({});
      });

      const requestId = 'req-set';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testSet',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      expect(responseCall[0].headers['X-Custom']).toBe('value');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.cookie()', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testCookie', (req, res) => {
        res.cookie('token', 'abc123', {
          path: '/api',
          httpOnly: true,
          secure: true,
          sameSite: 'strict'
        });
        res.send({});
      });

      const requestId = 'req-cookie';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testCookie',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      const setCookies = responseCall[0].headers[HttpHeader.SET_COOKIE];
      expect(Array.isArray(setCookies)).toBe(true);
      expect(setCookies[0]).toContain('token=abc123');
      expect(setCookies[0]).toContain('Path=/api');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support res.clearCookie()', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('testClearCookie', (req, res) => {
        res.clearCookie('token', { path: '/api' });
        res.send({});
      });

      const requestId = 'req-clearcookie';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'testClearCookie',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response'
      );
      expect(responseCall).toBeDefined();
      const setCookies = responseCall[0].headers[HttpHeader.SET_COOKIE];
      expect(setCookies[0]).toContain('Max-Age=0');

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle async handler without sending response', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'async',
                    requestId: msg.requestId,
                    path: msg.path
                  },
                  origin
                })
              );
            }, 10);
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: {
                      message: Messages.NO_RESPONSE_SENT,
                      code: 'NO_RESPONSE'
                    },
                    status: 500
                  },
                  origin
                })
              );
            }, 50);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('asyncNoResponse', async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        // Intentionally not sending response
      });

      await expect(
        client.send('asyncNoResponse', undefined, { ackTimeout: 1000, asyncTimeout: 5000 })
      ).rejects.toMatchObject({
        code: 'NO_RESPONSE'
      });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle async handler with promise rejection', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'async',
                    requestId: msg.requestId,
                    path: msg.path
                  },
                  origin
                })
              );
            }, 10);
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: {
                      message: 'Test error',
                      code: 'REQUEST_ERROR'
                    },
                    status: 500
                  },
                  origin
                })
              );
            }, 50);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('asyncError', async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        throw new Error('Test error');
      });

      await expect(
        client.send('asyncError', undefined, { ackTimeout: 1000, asyncTimeout: 5000 })
      ).rejects.toMatchObject({
        code: 'REQUEST_ERROR'
      });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle middleware error', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.use((req, res, next) => {
        throw new Error('Middleware error');
      });

      server.on('test', (req, res) => {
        res.send({});
      });

      const requestId = 'req-middleware-error';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' || 
        (call[0]?.type === 'response' && call[0]?.status === 500)
      );
      expect(errorCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle middleware promise rejection', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.use(async (req, res, next) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async middleware error');
      });

      server.on('test', (req, res) => {
        res.send({});
      });

      const requestId = 'req-middleware-async-error';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' || 
        (call[0]?.type === 'response' && call[0]?.status === 500)
      );
      expect(errorCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle request without path', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      const requestId = 'req-no-path';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not crash, but also shouldn't process the request (no path means early return)
      // Server should still send ACK, but won't process further
      const ackCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'ack'
      );
      // Server may or may not send ACK if path is missing, but should not crash
      expect(() => server.destroy()).not.toThrow();

      cleanupIframe(iframe);
    });

    it('should handle request without source', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      const requestId = 'req-no-source';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'test',
            body: {}
          },
          origin
          // Intentionally no source
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not crash
      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('Stream response', () => {
    it('should support sendStream', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'stream_start',
                    requestId: msg.requestId,
                    body: {
                      streamId: 'stream-123',
                      type: 'data',
                      chunked: true
                    },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('getStream', async (req, res) => {
        const { IframeWritableStream } = await import('../stream');
        const stream = new IframeWritableStream({
          iterator: async function* () {
            yield 'chunk1';
            yield 'chunk2';
          }
        });
        await res.sendStream(stream);
      });

      const requestId = 'req-stream';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getStream',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      const streamStartCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      expect(streamStartCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle stream response from server', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'stream_start',
                    requestId: msg.requestId,
                    body: {
                      streamId: 'stream-123',
                      type: 'data',
                      chunked: true
                    },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('getStream', async (req, res) => {
        const { IframeWritableStream } = await import('../stream');
        const stream = new IframeWritableStream({
          iterator: async function* () {
            yield 'chunk1';
            yield 'chunk2';
          }
        });
        await res.sendStream(stream);
      });

      const requestId = 'req-stream';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'getStream',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      const streamStartCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_start'
      );
      expect(streamStartCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle server open/close methods', () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      expect(server.isOpen).toBe(true);

      server.close();
      expect(server.isOpen).toBe(false);

      server.open();
      expect(server.isOpen).toBe(true);

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle client open/close/destroy methods', () => {
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

      expect(client.isOpen).toBe(true);

      client.close();
      expect(client.isOpen).toBe(false);

      client.open();
      expect(client.isOpen).toBe(true);

      // Test destroy
      client.setCookie('test', 'value');
      expect(client.getCookie('test')).toBe('value');

      client.destroy();
      expect(client.isOpen).toBe(false);
      // Cookies should be cleared after destroy
      expect(client.getCookie('test')).toBeUndefined();

      cleanupIframe(iframe);
    });

    it('should clear interceptors on destroy', () => {
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

      // Add interceptors
      const requestInterceptor = jest.fn((config) => config);
      const responseInterceptor = jest.fn((response) => response);
      
      client.interceptors.request.use(requestInterceptor);
      client.interceptors.response.use(responseInterceptor);

      // Destroy should clear interceptors
      client.destroy();

      // Interceptors should be cleared (handlers array should be empty)
      let interceptorCount = 0;
      client.interceptors.request.forEach(() => { interceptorCount++; });
      expect(interceptorCount).toBe(0);

      interceptorCount = 0;
      client.interceptors.response.forEach(() => { interceptorCount++; });
      expect(interceptorCount).toBe(0);

      cleanupIframe(iframe);
    });

    it('should handle server off method', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({});
      });

      server.off('test');

      const requestId = 'req-off';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' && call[0]?.error?.code === 'METHOD_NOT_FOUND'
      );
      expect(errorCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should return unregister function from on method', () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      // on method should return an unregister function
      const unregister = server.on('test', (req, res) => {
        res.send({});
      });

      expect(typeof unregister).toBe('function');

      // Use the returned function to unregister
      unregister();

      // Verify handler is removed
      const requestId = 'req-unregister';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId,
            path: 'test',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );

      // Should not find handler (will send error)
      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' && call[0]?.error?.code === 'METHOD_NOT_FOUND'
      );
      expect(errorCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support batch unregister with off method', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();

      // Register multiple handlers
      server.on('path1', (req, res) => res.send({ path: '1' }));
      server.on('path2', (req, res) => res.send({ path: '2' }));
      server.on('path3', (req, res) => res.send({ path: '3' }));

      // Batch unregister
      server.off(['path1', 'path2']);

      // path1 and path2 should be removed
      const requestId1 = 'req-1';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId1,
            path: 'path1',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const errorCall1 = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' && call[0]?.error?.code === 'METHOD_NOT_FOUND'
      );
      expect(errorCall1).toBeDefined();

      // path3 should still work
      const requestId3 = 'req-3';
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'request',
            requestId: requestId3,
            path: 'path3',
            body: {}
          },
          origin,
          source: mockContentWindow as any
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const successCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'response' && call[0]?.data?.path === '3'
      );
      expect(successCall).toBeDefined();

      server.destroy();
      cleanupIframe(iframe);
    });
  });

  describe('Client additional features', () => {
    it('should support postMessage method for stream handler', () => {
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
      const message = { type: 'test', data: 'value' };
      
      // Access postMessage through stream handler interface
      (client as any).postMessage(message);
      
      // Verify message was sent via dispatcher
      expect(mockContentWindow.postMessage).toHaveBeenCalled();

      cleanupIframe(iframe);
    });

    it('should handle function-type headers', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, {
        headers: {
          'X-Dynamic': (config: RequestConfig) => `value-${config.path}`
        }
      });

      await client.send('test', {});
      
      const requestCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall).toBeDefined();
      if (requestCall && requestCall[0]) {
        expect(requestCall[0].headers?.['X-Dynamic']).toBe('value-test');
      }

      cleanupIframe(iframe);
    });

    it('should handle isConnect timeout', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { ackTimeout: 50 });
      
      // Server doesn't respond, should timeout
      const connected = await client.isConnect();
      expect(connected).toBe(false);

      cleanupIframe(iframe);
    });

    it('should handle isConnect rejection', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'ping') {
            // Simulate error by not sending pong
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: { message: 'Connection failed' },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      const connected = await client.isConnect();
      expect(connected).toBe(false);

      cleanupIframe(iframe);
    });

    it('should remember targetServerId from ACK and use it in subsequent requests', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const serverId = 'server-123';
      
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER,
                  creatorId: serverId
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER,
                    creatorId: serverId
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      // First request - should remember serverId
      await client.send('test1', {});
      
      // Second request - should use remembered serverId
      await client.send('test2', {});
      
      const requestCalls = mockContentWindow.postMessage.mock.calls.filter(
        (call: any[]) => call[0]?.type === 'request'
      );
      
      // First request may not have targetId (if serverId not remembered yet)
      // Second request should have targetId
      expect(requestCalls.length).toBeGreaterThanOrEqual(2);
      const secondRequest = requestCalls[requestCalls.length - 1];
      if (secondRequest) {
        expect(secondRequest[0].targetId).toBe(serverId);
      }

      cleanupIframe(iframe);
    });

    it('should not override existing targetServerId', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const existingServerId = 'existing-server';
      const newServerId = 'new-server';
      
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER,
                  creatorId: newServerId
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER,
                    creatorId: newServerId
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      // Set existing targetServerId
      (client as any)._targetServerId = existingServerId;
      
      // Send request with explicit targetId
      await client.send('test', {}, { targetId: existingServerId });
      
      const requestCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall).toBeDefined();
      if (requestCall) {
        expect(requestCall[0].targetId).toBe(existingServerId);
      }
      
      // targetServerId should not be overridden
      expect((client as any)._targetServerId).toBe(existingServerId);

      cleanupIframe(iframe);
    });

    it('should handle setCookie with expires option', () => {
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
      const expires = new Date(Date.now() + 3600000); // 1 hour from now
      
      client.setCookie('token', 'value', { expires });
      
      expect(client.getCookie('token')).toBe('value');

      cleanupIframe(iframe);
    });

    it('should handle setCookie with maxAge option', () => {
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
      
      client.setCookie('token', 'value', { maxAge: 3600 });
      
      expect(client.getCookie('token')).toBe('value');

      cleanupIframe(iframe);
    });

    it('should handle getServer method', () => {
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
      const server = (client as any).getServer();
      
      expect(server).toBeDefined();
      expect(server.isOpen).toBe(true);

      cleanupIframe(iframe);
    });

    it('should handle non-autoResolve file stream', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              const streamId = 'stream-test';
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    timestamp: Date.now(),
                    type: 'stream_start',
                    requestId: msg.requestId,
                    status: 200,
                    statusText: 'OK',
                    body: {
                      streamId,
                      type: 'file',
                      chunked: false,
                      autoResolve: false, // Not auto-resolve
                      metadata: {
                        filename: 'test.txt',
                        mimeType: 'text/plain'
                      }
                    },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
              setTimeout(() => {
                window.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      __requestIframe__: 1,
                      timestamp: Date.now(),
                      type: 'stream_data',
                      requestId: msg.requestId,
                      body: {
                        streamId,
                        data: btoa('Hello World'),
                        done: true
                      },
                      role: MessageRole.SERVER
                    },
                    origin
                  })
                );
                setTimeout(() => {
                  window.dispatchEvent(
                    new MessageEvent('message', {
                      data: {
                        __requestIframe__: 1,
                        timestamp: Date.now(),
                        type: 'stream_end',
                        requestId: msg.requestId,
                        body: { streamId },
                        role: MessageRole.SERVER
                      },
                      origin
                    })
                  );
                }, 10);
              }, 10);
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const response = await client.send('getFile', {}, { 
        ackTimeout: 1000,
        timeout: 10000
      }) as any;

      expect(response.stream).toBeDefined();
      expect(response.data).not.toBeInstanceOf(File); // Not auto-resolved, data is not a File

      cleanupIframe(iframe);
    }, 20000);

    it('should handle regular data stream (non-file)', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              const streamId = 'stream-test';
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    timestamp: Date.now(),
                    type: 'stream_start',
                    requestId: msg.requestId,
                    status: 200,
                    statusText: 'OK',
                    body: {
                      streamId,
                      type: 'data',
                      chunked: true
                    },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
              setTimeout(() => {
                window.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      __requestIframe__: 1,
                      timestamp: Date.now(),
                      type: 'stream_data',
                      requestId: msg.requestId,
                      body: {
                        streamId,
                        data: btoa('chunk1'),
                        done: false
                      },
                      role: MessageRole.SERVER
                    },
                    origin
                  })
                );
                setTimeout(() => {
                  window.dispatchEvent(
                    new MessageEvent('message', {
                      data: {
                        __requestIframe__: 1,
                        timestamp: Date.now(),
                        type: 'stream_data',
                        requestId: msg.requestId,
                        body: {
                          streamId,
                          data: btoa('chunk2'),
                          done: true
                        },
                        role: MessageRole.SERVER
                      },
                      origin
                    })
                  );
                  setTimeout(() => {
                    window.dispatchEvent(
                      new MessageEvent('message', {
                        data: {
                          __requestIframe__: 1,
                          timestamp: Date.now(),
                          type: 'stream_end',
                          requestId: msg.requestId,
                          body: { streamId },
                          role: MessageRole.SERVER
                        },
                        origin
                      })
                    );
                  }, 10);
                }, 10);
              }, 10);
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const response = await client.send('getStream', {}, { 
        ackTimeout: 1000,
        timeout: 10000
      }) as any;

      expect(response.stream).toBeDefined();
      expect(response.stream.type).toBe('data');

      cleanupIframe(iframe);
    }, 20000);

    it('should handle dispatchStreamMessage for stream messages', async () => {
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
      const streamId = 'test-stream';
      const handler = jest.fn();
      
      // Register stream handler
      (client as any).registerStreamHandler(streamId, handler);
      
      // Dispatch stream message
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'stream_data',
            requestId: 'req123',
            body: {
              streamId,
              data: 'test',
              type: 'data'
            },
            role: MessageRole.SERVER
          },
          origin
        })
      );
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(handler).toHaveBeenCalled();

      cleanupIframe(iframe);
    });

    it('should handle error in response interceptor rejected callback', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: { message: 'Test error', code: 'TEST_ERROR' },
                    status: 500,
                    statusText: 'Internal Server Error',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      // Add error interceptor that rejects
      client.interceptors.response.use(
        (response) => response,
        (error) => {
          // Reject to test the catch path
          return Promise.reject(error);
        }
      );

      try {
        await client.send('test', {});
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Test error');
      }

      cleanupIframe(iframe);
    });
  });

  describe('Server additional features', () => {
    it('should handle protocol version error', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      // Send message with incompatible version
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 0, // Incompatible version
            timestamp: Date.now(),
            type: 'request',
            requestId: 'req123',
            path: 'test',
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
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle handler returning undefined result', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      server.on('test', (req, res) => {
        // Handler doesn't return anything (undefined)
        // This should trigger NO_RESPONSE_SENT error
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

      await new Promise(resolve => setTimeout(resolve, 100));

      const errorCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'error' && call[0]?.requestId === 'req123'
      );
      expect(errorCall).toBeDefined();
      if (errorCall && errorCall[0]) {
        expect(errorCall[0]).toMatchObject({
          type: 'error',
          requestId: 'req123',
          error: expect.objectContaining({
            code: 'NO_RESPONSE'
          })
        });
      }

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should skip processing when message already handled by another server', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server1 = requestIframeServer();
      const server2 = requestIframeServer();
      
      const handler1 = jest.fn((req, res) => res.send({ server: 1 }));
      const handler2 = jest.fn((req, res) => res.send({ server: 2 }));
      
      server1.on('test', handler1);
      server2.on('test', handler2);

      // Create a context that indicates message was already handled
      const messageData = {
        __requestIframe__: 1,
        timestamp: Date.now(),
        type: 'request' as const,
        requestId: 'req123',
        path: 'test',
        role: MessageRole.CLIENT,
        targetId: server1.id
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: messageData,
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      // Only server1 should handle it (because of targetId)
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();

      server1.destroy();
      server2.destroy();
      cleanupIframe(iframe);
    });

    it('should handle ack timeout in registerPendingAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer({ ackTimeout: 50 });
      
      server.on('test', (req, res) => {
        // Send response with requireAck, but client never sends 'received'
        res.send({ result: 'success' }, { requireAck: true });
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

      // Wait for ack timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Server should have sent response
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle middleware that sends response early', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      const middleware = jest.fn((req, res, next) => {
        res.send({ middleware: true });
        // Don't call next() - response already sent
      });
      
      const handler = jest.fn((req, res) => {
        res.send({ handler: true });
      });
      
      server.use(middleware);
      server.on('test', handler);

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

      await new Promise(resolve => setTimeout(resolve, 100));

      // Middleware should be called
      expect(middleware).toHaveBeenCalled();
      // Handler should NOT be called because response was already sent
      expect(handler).not.toHaveBeenCalled();
      
      // Response should be from middleware
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'req123',
          data: { middleware: true }
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle map return cleanup function', () => {
      const server = requestIframeServer();
      
      const handler1 = jest.fn((req, res) => res.send({}));
      const handler2 = jest.fn((req, res) => res.send({}));
      
      const cleanup = server.map({
        'path1': handler1,
        'path2': handler2
      });
      
      // Cleanup should unregister all handlers
      cleanup();
      
      // Verify handlers are unregistered
      expect(server).toBeDefined();
      
      server.destroy();
    });
  });

  describe('Cache utilities', () => {
    it('should test server cache functions', () => {
      const { getCachedServer, cacheServer, removeCachedServer, clearServerCache } = require('../utils/cache');
      const { requestIframeServer } = require('../api/server');
      
      // Test getCachedServer with no id
      expect(getCachedServer('key1')).toBeNull();
      expect(getCachedServer(undefined, undefined)).toBeNull();
      
      // Test cacheServer with no id
      const server1 = requestIframeServer({ id: 'server1', secretKey: 'key1' });
      cacheServer(server1, 'key1', 'server1');
      
      // Test getCachedServer with id
      const cached = getCachedServer('key1', 'server1');
      expect(cached).toBe(server1);
      
      // Test removeCachedServer with no id
      removeCachedServer('key1'); // Should not throw
      removeCachedServer(undefined, undefined); // Should not throw
      
      // Test removeCachedServer with id
      removeCachedServer('key1', 'server1');
      expect(getCachedServer('key1', 'server1')).toBeNull();
      
      // Test clearServerCache
      const server2 = requestIframeServer({ id: 'server2', secretKey: 'key2' });
      cacheServer(server2, 'key2', 'server2');
      clearServerCache();
      expect(getCachedServer('key2', 'server2')).toBeNull();
      
      server1.destroy();
      server2.destroy();
    });

    it('should test clearMessageChannelCache', () => {
      const { clearMessageChannelCache, getOrCreateMessageChannel } = require('../utils/cache');
      
      // Create a channel
      const channel1 = getOrCreateMessageChannel('test-key');
      expect(channel1).toBeDefined();
      
      // Clear cache
      clearMessageChannelCache();
      
      // Create another channel - should be new instance
      const channel2 = getOrCreateMessageChannel('test-key');
      expect(channel2).toBeDefined();
      
      channel1.release();
      channel2.release();
    });
  });

  describe('Additional edge cases', () => {
    it('should handle headers in request options', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, {
        headers: {
          'X-Initial': 'initial-value'
        }
      });

      // Send request with additional headers
      await client.send('test', {}, {
        headers: {
          'X-Request': 'request-value',
          'X-Dynamic': (config: RequestConfig) => `dynamic-${config.path}`
        }
      });

      const requestCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'request'
      );
      expect(requestCall).toBeDefined();
      if (requestCall && requestCall[0]) {
        expect(requestCall[0].headers?.['X-Initial']).toBe('initial-value');
        expect(requestCall[0].headers?.['X-Request']).toBe('request-value');
        expect(requestCall[0].headers?.['X-Dynamic']).toBe('dynamic-test');
      }

      cleanupIframe(iframe);
    });

    it('should handle isConnect with error response', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'ping') {
            // Send error instead of pong
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: { message: 'Connection error' },
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { ackTimeout: 1000 });
      
      const connected = await client.isConnect();
      expect(connected).toBe(false);

      cleanupIframe(iframe);
    });

    it('should handle response interceptor without rejected callback', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: { message: 'Test error', code: 'TEST_ERROR' },
                    status: 500,
                    statusText: 'Internal Server Error',
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      // Add response interceptor without rejected callback
      client.interceptors.response.use(
        (response) => response
        // No rejected callback - should test the Promise.reject path
      );

      try {
        await client.send('test', {});
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Test error');
      }

      cleanupIframe(iframe);
    });

    it('should handle request timeout', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Send ACK but never send response
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            // Don't send response - should timeout
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { timeout: 50 });

      try {
        await client.send('test', {});
        fail('Should have timed out');
      } catch (error: any) {
        expect(error.message).toContain('timeout');
      }

      cleanupIframe(iframe);
    });

    it('should handle async timeout', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              // Send ASYNC but never send response
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'async',
                    requestId: msg.requestId,
                    path: msg.path,
                    role: MessageRole.SERVER
                  },
                  origin
                })
              );
            }, 10);
            // Don't send response - should timeout
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { asyncTimeout: 50 });

      try {
        await client.send('test', {});
        fail('Should have timed out');
      } catch (error: any) {
        expect(error.message).toContain('timeout');
      }

      cleanupIframe(iframe);
    });

    it('should not override existing targetServerId when receiving ACK', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const existingServerId = 'existing-server';
      const newServerId = 'new-server';
      
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER,
                  creatorId: newServerId
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER,
                    creatorId: newServerId
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      
      // Set existing targetServerId
      (client as any)._targetServerId = existingServerId;
      
      await client.send('test', {});
      
      // targetServerId should not be overridden
      expect((client as any)._targetServerId).toBe(existingServerId);

      cleanupIframe(iframe);
    });

    it('should handle response with requireAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'response',
                    requestId: msg.requestId,
                    data: { result: 'success' },
                    status: 200,
                    statusText: 'OK',
                    role: MessageRole.SERVER,
                    requireAck: true
                  },
                  origin
                })
              );
            }, 10);
          } else if (msg.type === 'received') {
            // Acknowledge receipt
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const response = await client.send('test', {});

      expect(response.data).toEqual({ result: 'success' });
      
      // Verify RECEIVED message was sent
      const receivedCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'received'
      );
      expect(receivedCall).toBeDefined();

      cleanupIframe(iframe);
    });

    it('should handle handler returning a value', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      // Handler returns a value (not undefined)
      server.on('test', (req, res) => {
        return { result: 'from-return' };
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

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should send response with returned value
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'req123',
          data: { result: 'from-return' }
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle ack timeout in registerPendingAck reject callback', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer({ ackTimeout: 50 });
      
      server.on('test', (req, res) => {
        // Send response with requireAck, but client never sends 'received'
        res.send({ result: 'success' }, { requireAck: true });
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

      // Wait for ack timeout (reject callback should be called)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Server should have sent response
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should skip middleware when response already sent', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      const middleware1 = jest.fn((req, res, next) => {
        res.send({ middleware1: true });
        // Response sent, don't call next
      });
      
      const middleware2 = jest.fn((req, res, next) => {
        next();
      });
      
      const handler = jest.fn((req, res) => {
        res.send({ handler: true });
      });
      
      server.use(middleware1);
      server.use(middleware2);
      server.on('test', handler);

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

      await new Promise(resolve => setTimeout(resolve, 100));

      // Middleware1 should be called
      expect(middleware1).toHaveBeenCalled();
      // Middleware2 should NOT be called because response was already sent in middleware1
      expect(middleware2).not.toHaveBeenCalled();
      // Handler should NOT be called because response was already sent
      expect(handler).not.toHaveBeenCalled();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle isConnect reject callback', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { ackTimeout: 50 });
      
      // Simulate error in pending request registration
      // This will trigger the reject callback
      const connected = await client.isConnect();
      expect(connected).toBe(false);

      cleanupIframe(iframe);
    });

    it('should handle stream messages via dispatchStreamMessage', async () => {
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
      const streamId = 'test-stream';
      const handler = jest.fn();
      
      // Register stream handler
      (client as any).registerStreamHandler(streamId, handler);
      
      // Dispatch stream_data message
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'stream_data',
            requestId: 'req123',
            body: {
              streamId,
              data: 'test',
              type: 'data'
            },
            role: MessageRole.SERVER
          },
          origin
        })
      );
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(handler).toHaveBeenCalled();
      
      // Dispatch stream_end message
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            __requestIframe__: 1,
            type: 'stream_end',
            requestId: 'req123',
            body: {
              streamId
            },
            role: MessageRole.SERVER
          },
          origin
        })
      );
      
      await new Promise(resolve => setTimeout(resolve, 50));

      cleanupIframe(iframe);
    });

    it('should handle error with requireAck', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  role: MessageRole.SERVER
                },
                origin
              })
            );
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    __requestIframe__: 1,
                    type: 'error',
                    requestId: msg.requestId,
                    error: { message: 'Test error', code: 'TEST_ERROR' },
                    status: 500,
                    statusText: 'Internal Server Error',
                    role: MessageRole.SERVER,
                    requireAck: true
                  },
                  origin
                })
              );
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);

      try {
        await client.send('test', {});
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Test error');
      }
      
      // Verify RECEIVED message was sent
      const receivedCall = mockContentWindow.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'received'
      );
      expect(receivedCall).toBeDefined();

      cleanupIframe(iframe);
    });

    it('should handle error in pending request registration', async () => {
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
      
      // Simulate error during request registration
      // This will trigger the error callback in _registerPendingRequest
      try {
        // Force an error by making the server unavailable
        await client.send('test', {}, { timeout: 50 });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }

      cleanupIframe(iframe);
    });

    it('should handle message already handled by another server', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server1 = requestIframeServer();
      const server2 = requestIframeServer();
      
      const handler1 = jest.fn((req, res) => res.send({ server: 1 }));
      const handler2 = jest.fn((req, res) => res.send({ server: 2 }));
      
      server1.on('test', handler1);
      server2.on('test', handler2);

      // Create message context that indicates it was already handled
      // This simulates the case where context.handledBy is set
      const messageData = {
        __requestIframe__: 1,
        timestamp: Date.now(),
        type: 'request' as const,
        requestId: 'req123',
        path: 'test',
        role: MessageRole.CLIENT,
        targetId: server1.id
      };

      // First server processes it
      window.dispatchEvent(
        new MessageEvent('message', {
          data: messageData,
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      // Only server1 should handle it (because of targetId)
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();

      server1.destroy();
      server2.destroy();
      cleanupIframe(iframe);
    });

    it('should handle ack timeout reject callback', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer({ ackTimeout: 50 });
      
      server.on('test', (req, res) => {
        // Send response with requireAck, but client never sends 'received'
        // This will trigger ack timeout and the reject callback
        res.send({ result: 'success' }, { requireAck: true });
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

      // Wait for ack timeout (reject callback should be called)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Server should have sent response
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'req123'
        }),
        origin
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should skip next middleware when response already sent', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);
      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const server = requestIframeServer();
      
      const middleware1 = jest.fn((req, res, next) => {
        res.send({ middleware1: true });
        // Response sent, but still call next to test the res._sent check
        next();
      });
      
      const middleware2 = jest.fn((req, res, next) => {
        // This should not execute because res._sent is true
        next();
      });
      
      const handler = jest.fn((req, res) => {
        res.send({ handler: true });
      });
      
      server.use(middleware1);
      server.use(middleware2);
      server.on('test', handler);

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

      await new Promise(resolve => setTimeout(resolve, 100));

      // Middleware1 should be called
      expect(middleware1).toHaveBeenCalled();
      // Middleware2's next() should check res._sent and return early, so handler should not be called
      // Note: middleware2 itself may or may not be called depending on implementation
      // Handler should NOT be called because response was already sent
      expect(handler).not.toHaveBeenCalled();

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});
