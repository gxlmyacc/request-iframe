import { requestIframeClient } from '../../src/api/client';
import { requestIframeServer } from '../../src/api/server';
import type { PostMessageData } from '../../src/types';
import { MessageRole } from '../../src/constants';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Basic functionality', () => {
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

    it('should return response.data when returnData is true in options', async () => {
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

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      const data = await client.send('test', { param: 'value' }, { ackTimeout: 1000, returnData: true });
      // Should return data directly, not Response object
      expect(data).toEqual({ result: 'success' });
      expect((data as any).status).toBeUndefined();
      expect((data as any).requestId).toBeUndefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should return full Response when returnData is false', async () => {
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

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      const response = await client.send('test', { param: 'value' }, { ackTimeout: 1000, returnData: false });
      // Should return full Response object
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('statusText');
      expect(response).toHaveProperty('requestId');
      expect(response.data).toEqual({ result: 'success' });
      expect(response.status).toBe(200);

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should use default returnData from RequestIframeClientOptions', async () => {
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

      // Create client with returnData: true in options
      const client = requestIframeClient(iframe, { returnData: true });
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Should return data directly without specifying returnData in send options
      const data = await client.send('test', { param: 'value' }, { ackTimeout: 1000 });
      expect(data).toEqual({ result: 'success' });
      expect((data as any).status).toBeUndefined();

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should allow overriding default returnData in send options', async () => {
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

      // Create client with returnData: true in options
      const client = requestIframeClient(iframe, { returnData: true });
      const server = requestIframeServer();

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Override with returnData: false in send options
      const response = await client.send('test', { param: 'value' }, { ackTimeout: 1000, returnData: false });
      // Should return full Response object despite default being true
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('status');
      expect(response.data).toEqual({ result: 'success' });

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

      await expect(client.send('test', undefined, { ackTimeout: 100 })).rejects.toMatchObject({
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
});

