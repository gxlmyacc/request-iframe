import { requestIframeClient } from '../../api/client';
import { requestIframeServer } from '../../api/server';
import type { RequestConfig, Response, PostMessageData } from '../../types';
import { MessageRole } from '../../constants';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Interceptors / Error handling / Async tasks', () => {
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
        response.data = { ...(response.data as any), intercepted: true };
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
        await new Promise((resolve) => setTimeout(resolve, 50));
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
});

