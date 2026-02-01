import { setupClientDebugInterceptors, setupServerDebugListeners } from '../src/utils/debug';
import { requestIframeClient, clearRequestIframeClientCache } from '../src/api/client';
import { requestIframeServer, clearRequestIframeServerCache } from '../src/api/server';
import { MessageType, MessageRole } from '../src/constants';

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

describe('debug', () => {
  beforeEach(() => {
    clearRequestIframeClientCache();
    clearRequestIframeServerCache();
    jest.clearAllMocks();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
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

  describe('setupClientDebugInterceptors', () => {
    it('should log request start', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: any) => {
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

      const client = requestIframeClient(iframe);
      setupClientDebugInterceptors(client);

      await client.send('test', { param: 'value' }, { ackTimeout: 1000 });

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Client] Request Start'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          path: 'test',
          body: { param: 'value' }
        })
      );

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Client] Request Success'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          requestId: expect.any(String),
          status: 200
        })
      );

      cleanupIframe(iframe);
    });

    it('should log request failure', async () => {
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
      setupClientDebugInterceptors(client);

      try {
        await client.send('test', undefined, { ackTimeout: 50, timeout: 100 });
      } catch (error) {
        // Expected to fail
      }

      // Wait a bit for error logging
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[Client] Request Failed'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          code: expect.any(String)
        })
      );

      cleanupIframe(iframe);
    });

    it('should log file response', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: any) => {
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
      setupClientDebugInterceptors(client);

      const response = await client.send('getFile', undefined, { 
        ackTimeout: 1000,
        timeout: 10000
      }) as any;

      expect(response.data).toBeInstanceOf(File);
      const file = response.data as File;
      expect(file.name).toBe('test.txt');
      
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Client] Request Success (File)'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          fileData: expect.objectContaining({
            fileName: 'test.txt'
          })
        })
      );

      cleanupIframe(iframe);
    }, 20000);

    it('should log incoming messages', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: any) => {
          if (msg.type === 'request') {
            setTimeout(() => {
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
            }, 10);
          }
        })
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      setupClientDebugInterceptors(client);

      await client.send('test', undefined, { ackTimeout: 1000, timeout: 5000 });

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Client] Received ACK'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          requestId: expect.any(String)
        })
      );

      cleanupIframe(iframe);
    }, 10000);
  });

  describe('setupServerDebugListeners', () => {
    it('should log received request', async () => {
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
      setupServerDebugListeners(server);

      server.on('test', (req, res) => {
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
            body: { param: 'value' },
            role: MessageRole.CLIENT,
            targetId: server.id
          },
          origin,
          source: mockContentWindow as any
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Received Request'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          path: 'test',
          body: { param: 'value' }
        })
      );

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Sending Response'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          status: 200
        })
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should log status code changes', async () => {
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
      setupServerDebugListeners(server);

      server.on('test', (req, res) => {
        res.status(404).send({ error: 'Not Found' });
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

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Setting Status Code'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          statusCode: 404
        })
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should log header changes', async () => {
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
      setupServerDebugListeners(server);

      server.on('test', (req, res) => {
        res.setHeader('X-Custom', 'value');
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

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Setting Header'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          header: 'X-Custom',
          value: 'value'
        })
      );

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should log sendFile', async () => {
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
      setupServerDebugListeners(server);

      server.on('test', async (req, res) => {
        await res.sendFile('Hello World', {
          fileName: 'test.txt',
          mimeType: 'text/plain'
        });
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

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Sending File'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          fileName: 'test.txt',
          mimeType: 'text/plain'
        })
      );

      server.destroy();
      cleanupIframe(iframe);
    }, 10000);

    it('should log json response', async () => {
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
      setupServerDebugListeners(server);

      server.on('test', (req, res) => {
        res.json({ result: 'success' });
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

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[Server] Sending JSON Response'),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          status: 200
        })
      );

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});
