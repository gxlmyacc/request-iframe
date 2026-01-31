import { requestIframeClient } from '../../api/client';
import { requestIframeServer } from '../../api/server';
import type { PostMessageData } from '../../types';
import { MessageRole } from '../../constants';
import { createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - sendFile', () => {
  describe('sendFile', () => {
    it('should support sending file (stream)', async () => {
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

      // Trigger via client (pull/ack protocol requires receiver)
      const response = await client.send('getFile', {});
      expect((response as any).data).toBeDefined();

      // Verify sendFile was called - now it uses stream
      expect(mockContentWindow.postMessage).toHaveBeenCalled();

      // Debug: Check all message types sent
      const allCalls = mockContentWindow.postMessage.mock.calls;
      const messageTypes = allCalls.map((call: any[]) => call[0]?.type).filter(Boolean);
      if (messageTypes.length === 0) {
        throw new Error('No messages were sent to mockContentWindow.postMessage');
      }

      const streamStartCall = allCalls.find((call: any[]) => call[0]?.type === 'stream_start');
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
      const streamDataCall = mockContentWindow.postMessage.mock.calls.find((call: any[]) => call[0]?.type === 'stream_data');
      expect(streamDataCall).toBeDefined();

      // Verify stream_end was sent
      const streamEndCall = mockContentWindow.postMessage.mock.calls.find((call: any[]) => call[0]?.type === 'stream_end');
      expect(streamEndCall).toBeDefined();

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sending Blob file', async () => {
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
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('getBlob', async (req, res) => {
        const blob = new Blob(['test content'], { type: 'text/plain' });
        await res.sendFile(blob, {
          fileName: 'blob.txt',
          mimeType: 'text/plain'
        });
      });

      const response = await client.send('getBlob', {});
      expect((response as any).data).toBeDefined();

      // Verify stream_start was sent
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find((call: any[]) => call[0]?.type === 'stream_start');
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);
      expect(streamBody.metadata?.mimeType).toBe('text/plain');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sending File object', async () => {
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
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('getFileObj', async (req, res) => {
        const file = new File(['file content'], 'test.txt', { type: 'text/plain' });
        await res.sendFile(file);
      });

      const response = await client.send('getFileObj', {});
      expect((response as any).data).toBeDefined();

      // Verify stream_start was sent
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find((call: any[]) => call[0]?.type === 'stream_start');
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);
      expect(streamBody.metadata?.filename).toBe('test.txt');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support sendFile with requireAck', async () => {
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
      Object.defineProperty(iframe, 'contentWindow', {
        value: mockContentWindow,
        writable: true
      });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('getFileAck', async (req, res) => {
        await res.sendFile('test', {
          fileName: 'test.txt',
          requireAck: true
        });
      });

      const response = await client.send('getFileAck', {});
      expect((response as any).data).toBeDefined();

      // Verify stream_start was sent with requireAck
      const streamStartCall = mockContentWindow.postMessage.mock.calls.find((call: any[]) => call[0]?.type === 'stream_start');
      expect(streamStartCall).toBeDefined();
      const streamBody = streamStartCall![0].body;
      expect(streamBody.type).toBe('file');
      expect(streamBody.autoResolve).toBe(true);

      client.destroy();
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

      const response = (await client.send('getFile', undefined, {
        ackTimeout: 1000,
        timeout: 10000
      })) as any;

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
});

