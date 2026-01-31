import { requestIframeClient } from '../../api/client';
import { requestIframeServer } from '../../api/server';
import type { PostMessageData } from '../../types';
import { MessageRole } from '../../constants';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - MessageChannel sharing / secretKey isolation', () => {
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

  describe('secretKey message isolation', () => {
    it('should successfully communicate when client and server use the same secretKey', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Verify secretKey is in message
            expect(msg.secretKey).toBe('test-key');
            // Verify path is NOT prefixed with secretKey
            expect(msg.path).toBe('test');

            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  secretKey: 'test-key',
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
                    secretKey: 'test-key',
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

      const client = requestIframeClient(iframe, { secretKey: 'test-key' });
      const server = requestIframeServer({ secretKey: 'test-key' });

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      const response = await client.send('test', { param: 'value' }, { ackTimeout: 1000 });
      expect((response as any).data).toEqual({ result: 'success' });
      expect((response as any).status).toBe(200);
      expect(mockContentWindow.postMessage).toHaveBeenCalled();

      // Verify the sent message has secretKey
      const sentMessage = (mockContentWindow.postMessage as jest.Mock).mock.calls[0][0];
      expect(sentMessage.secretKey).toBe('test-key');
      expect(sentMessage.path).toBe('test'); // Path should NOT be prefixed

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should NOT communicate when client and server use different secretKeys', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { secretKey: 'client-key' });
      const server = requestIframeServer({ secretKey: 'server-key' });

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Request should timeout because server won't respond (different secretKey)
      await expect(client.send('test', { param: 'value' }, { ackTimeout: 100 })).rejects.toMatchObject({
        code: 'ACK_TIMEOUT'
      });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should NOT communicate when client has secretKey but server does not', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe, { secretKey: 'client-key' });
      const server = requestIframeServer(); // No secretKey

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Request should timeout because server won't respond (different secretKey)
      await expect(client.send('test', { param: 'value' }, { ackTimeout: 100 })).rejects.toMatchObject({
        code: 'ACK_TIMEOUT'
      });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should NOT communicate when client has no secretKey but server has secretKey', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn()
      };
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe); // No secretKey
      const server = requestIframeServer({ secretKey: 'server-key' });

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      // Request should timeout because server won't respond (different secretKey)
      await expect(client.send('test', { param: 'value' }, { ackTimeout: 100 })).rejects.toMatchObject({
        code: 'ACK_TIMEOUT'
      });

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should successfully communicate when both client and server have no secretKey', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Verify secretKey is NOT in message
            expect(msg.secretKey).toBeUndefined();
            // Verify path is NOT prefixed
            expect(msg.path).toBe('test');

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

      const client = requestIframeClient(iframe); // No secretKey
      const server = requestIframeServer(); // No secretKey

      server.on('test', (req, res) => {
        res.send({ result: 'success' });
      });

      const response = await client.send('test', { param: 'value' }, { ackTimeout: 1000 });
      expect((response as any).data).toEqual({ result: 'success' });
      expect((response as any).status).toBe(200);
      expect(mockContentWindow.postMessage).toHaveBeenCalled();

      // Verify the sent message has no secretKey
      const sentMessage = (mockContentWindow.postMessage as jest.Mock).mock.calls[0][0];
      expect(sentMessage.secretKey).toBeUndefined();
      expect(sentMessage.path).toBe('test'); // Path should NOT be prefixed

      server.destroy();
      cleanupIframe(iframe);
    });

    it('should handle path correctly with secretKey (path should not be prefixed)', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow = {
        postMessage: jest.fn((msg: PostMessageData) => {
          if (msg.type === 'request') {
            // Verify path is NOT prefixed with secretKey
            expect(msg.path).toBe('api/users');
            expect(msg.secretKey).toBe('my-app');

            // Send ACK first
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  __requestIframe__: 1,
                  type: 'ack',
                  requestId: msg.requestId,
                  path: msg.path,
                  secretKey: 'my-app',
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
                    data: { users: [] },
                    status: 200,
                    statusText: 'OK',
                    secretKey: 'my-app',
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

      const client = requestIframeClient(iframe, { secretKey: 'my-app' });
      const server = requestIframeServer({ secretKey: 'my-app' });

      // Server registers handler with original path (not prefixed)
      server.on('api/users', (req, res) => {
        res.send({ users: [] });
      });

      // Client sends request with original path (not prefixed)
      const response = await client.send('api/users', undefined, { ackTimeout: 1000 });
      expect((response as any).data).toEqual({ users: [] });

      // Verify path in sent message is NOT prefixed
      const sentMessage = (mockContentWindow.postMessage as jest.Mock).mock.calls[0][0];
      expect(sentMessage.path).toBe('api/users');
      expect(sentMessage.secretKey).toBe('my-app');

      server.destroy();
      cleanupIframe(iframe);
    });
  });
});

