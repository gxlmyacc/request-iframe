/**
 * Stream functionality tests
 */
import type { MessageChannel } from '../src/message';
import {
  IframeWritableStream,
  IframeReadableStream,
  IframeFileWritableStream,
  IframeFileReadableStream,
  isIframeReadableStream,
  isIframeFileReadableStream,
  isIframeFileWritableStream,
  StreamMessageHandler
} from '../src/stream';

describe('Stream', () => {
  describe('IframeWritableStream', () => {
    let mockTargetWindow: Window;
    let mockPostMessage: jest.Mock;
    /** Mock channel: only send() is used by WritableStream */
    let mockChannel: MessageChannel;
    let controlHandlers: Map<string, (data: any) => void>;

    beforeEach(() => {
      mockPostMessage = jest.fn();
      mockTargetWindow = {
        postMessage: mockPostMessage
      } as any;
      mockChannel = {
        send: (target: Window, message: any, origin: string) => {
          target.postMessage(message, origin);
          return true;
        }
      } as unknown as MessageChannel;
      controlHandlers = new Map();
    });

    it('should create stream with default options', () => {
      const stream = new IframeWritableStream();
      
      expect(stream.streamId).toBeDefined();
      expect(stream.type).toBe('data');
      expect(stream.chunked).toBe(true);
      expect(stream.state).toBe('pending');
    });

    it('should create stream with custom options', () => {
      const stream = new IframeWritableStream({
        type: 'file',
        chunked: false,
        metadata: { foo: 'bar' }
      });
      
      expect(stream.type).toBe('file');
      expect(stream.chunked).toBe(false);
    });

    it('should throw error when starting without binding', async () => {
      const stream = new IframeWritableStream();
      
      await expect(stream.start()).rejects.toThrow();
    });

    it('should generate unique stream IDs', () => {
      const stream1 = new IframeWritableStream();
      const stream2 = new IframeWritableStream();
      
      expect(stream1.streamId).not.toBe(stream2.streamId);
    });

    it('should start stream with iterator', async () => {
      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
          yield 'chunk2';
          yield 'chunk3';
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      // Receiver grants credit (pull protocol)
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 10 });
      await startPromise;

      expect(stream.state).toBe('ended');
      // start + 3 data chunks + end = 5 calls
      expect(mockPostMessage).toHaveBeenCalledTimes(5);
    });

    it('should stop streaming when target window is closed', async () => {
      let streamDataCount = 0;
      mockPostMessage.mockImplementation((msg: any) => {
        if (msg?.type === 'stream_data') {
          streamDataCount += 1;
          // After first chunk, simulate target window closed
          (mockTargetWindow as any).closed = true;
        }
      });

      // Make mockChannel respect closed flag
      (mockChannel as any).send = (target: any, message: any, origin: string) => {
        if (target?.closed === true) return false;
        target.postMessage(message, origin);
        return true;
      };

      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
          yield 'chunk2';
          yield 'chunk3';
        }
      });

      // mockTargetWindow now supports closed/document checks in isWindowAvailable
      (mockTargetWindow as any).closed = false;
      (mockTargetWindow as any).document = {};

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 10 });
      await expect(startPromise).rejects.toThrow('Stream was cancelled');
      expect(stream.state).toBe('cancelled');
      expect(streamDataCount).toBe(1);
    });

    it('should start stream with next function', async () => {
      let callCount = 0;
      const stream = new IframeWritableStream({
        next: () => {
          callCount++;
          if (callCount === 1) {
            return { data: 'chunk1', done: false };
          } else if (callCount === 2) {
            return { data: 'chunk2', done: false };
          } else {
            return { data: 'chunk3', done: true };
          }
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 10 });
      await startPromise;

      expect(stream.state).toBe('ended');
      // start + 3 data chunks + end = 5 calls
      expect(mockPostMessage).toHaveBeenCalledTimes(5);
    });

    it('should start stream without data source', async () => {
      const stream = new IframeWritableStream();

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 1 });
      await startPromise;

      expect(stream.state).toBe('ended');
      expect(mockPostMessage).toHaveBeenCalledTimes(2); // start + end
    });

    it('should handle iterator error', async () => {
      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
          throw new Error('Iterator error');
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 10 });
      await startPromise;

      expect(stream.state).toBe('error');
      const errorCall = mockPostMessage.mock.calls.find((call: any[]) => 
        call[0]?.type === 'stream_error'
      );
      expect(errorCall).toBeDefined();
    });

    it('should handle next function error', async () => {
      const stream = new IframeWritableStream({
        next: () => {
          throw new Error('Next error');
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 1 });
      await startPromise;

      expect(stream.state).toBe('error');
    });

    it('should cancel stream', () => {
      const stream = new IframeWritableStream();

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel
      });

      stream.cancel('User cancelled');

      expect(stream.state).toBe('cancelled');
      const cancelCall = mockPostMessage.mock.calls.find((call: any[]) => 
        call[0]?.type === 'stream_cancel'
      );
      expect(cancelCall).toBeDefined();
    });

    it('should not cancel if already ended', () => {
      const stream = new IframeWritableStream();
      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel
      });

      // Manually set state to ended (simulating already ended)
      (stream as any)._state = 'ended';
      mockPostMessage.mockClear();

      stream.cancel('User cancelled');

      expect(stream.state).toBe('ended');
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should use channel if provided', async () => {
      const mockChannel = {
        send: jest.fn(() => true)
      } as any;

      const stream = new IframeWritableStream();

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 1 });
      await startPromise;

      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should handle stream cancellation before start', () => {
      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel
      });

      stream.cancel('User cancelled');

      expect(stream.state).toBe('cancelled');
      const cancelCall = mockPostMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_cancel'
      );
      expect(cancelCall).toBeDefined();
    });

    it('should handle stream error during iteration', async () => {
      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
          throw new Error('Stream error');
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel,
        registerStreamHandler: (streamId: string, handler: any) => {
          controlHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          controlHandlers.delete(streamId);
        }
      });

      const startPromise = stream.start();
      controlHandlers.get(stream.streamId)?.({ streamId: stream.streamId, type: 'pull', credit: 10 });
      await startPromise;

      expect(stream.state).toBe('error');
      const errorCall = mockPostMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'stream_error'
      );
      expect(errorCall).toBeDefined();
    });

    it('should not end if already cancelled', async () => {
      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'chunk1';
        }
      });

      stream._bind({
        requestId: 'req-123',
        targetWindow: mockTargetWindow,
        targetOrigin: 'https://example.com',
        secretKey: 'test',
        channel: mockChannel
      });

      const startPromise = stream.start();
      stream.cancel('Cancelled');
      await startPromise;

      expect(stream.state).toBe('cancelled');
    });
  });

  describe('IframeReadableStream', () => {
    let mockHandler: StreamMessageHandler;
    let registeredHandlers: Map<string, (data: any) => void>;

    beforeEach(() => {
      registeredHandlers = new Map();
      mockHandler = {
        registerStreamHandler: jest.fn((streamId, handler) => {
          registeredHandlers.set(streamId, handler);
        }),
        unregisterStreamHandler: jest.fn((streamId) => {
          registeredHandlers.delete(streamId);
        }),
        postMessage: jest.fn()
      };
    });

    it('should create readable stream', () => {
      const stream = new IframeReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler,
        { type: 'data', chunked: true }
      );

      expect(stream.streamId).toBe('test-stream-id');
      expect(stream.type).toBe('data');
      expect(stream.chunked).toBe(true);
      expect(stream.state).toBe('pending');
      expect(mockHandler.registerStreamHandler).toHaveBeenCalledWith(
        'test-stream-id',
        expect.any(Function)
      );
    });

    it('should handle stream data', async () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      expect(handler).toBeDefined();

      // Send data
      handler!({ type: 'data', streamId: 'test-stream-id', data: 'chunk1' });
      handler!({ type: 'data', streamId: 'test-stream-id', data: 'chunk2', done: true });

      // Read data
      const result = await stream.read();
      expect(result).toEqual(['chunk1', 'chunk2']);
      expect(stream.state).toBe('ended');
    });

    it('should handle stream end', async () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      
      const onEndCallback = jest.fn();
      stream.onEnd(onEndCallback);

      handler!({ type: 'data', streamId: 'test-stream-id', data: 'test' });
      handler!({ type: 'end', streamId: 'test-stream-id' });

      await stream.read();
      expect(onEndCallback).toHaveBeenCalled();
    });

    it('should handle stream error', async () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      
      const onErrorCallback = jest.fn();
      stream.onError(onErrorCallback);

      handler!({ type: 'error', streamId: 'test-stream-id', error: 'Test error' });

      await expect(stream.read()).rejects.toThrow();
      expect(onErrorCallback).toHaveBeenCalled();
      expect(stream.state).toBe('error');
    });

    it('should support async iterator', async () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      
      // Simulate async data sending
      setTimeout(() => {
        handler!({ type: 'data', streamId: 'test-stream-id', data: 'a' });
        handler!({ type: 'data', streamId: 'test-stream-id', data: 'b' });
        handler!({ type: 'end', streamId: 'test-stream-id' });
      }, 10);

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
        if (chunks.length >= 2) break; // Prevent infinite wait
      }

      expect(chunks).toEqual(['a', 'b']);
    });

    it('should cancel stream', () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      stream.cancel('User cancelled');

      expect(stream.state).toBe('cancelled');
      expect(mockHandler.postMessage).toHaveBeenCalled();
      expect(mockHandler.unregisterStreamHandler).toHaveBeenCalledWith('test-stream-id');
    });

    it('should not cancel if already ended', () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      handler!({ type: 'end', streamId: 'test-stream-id' });

      jest.clearAllMocks();
      stream.cancel('User cancelled');

      expect(stream.state).toBe('ended');
      expect(mockHandler.postMessage).not.toHaveBeenCalled();
    });

    it('should not cancel if already in error state', () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      handler!({ type: 'error', streamId: 'test-stream-id', error: 'Error' });

      jest.clearAllMocks();
      stream.cancel('User cancelled');

      expect(stream.state).toBe('error');
      expect(mockHandler.postMessage).not.toHaveBeenCalled();
    });

    it('should handle stream data with done flag', async () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      handler!({ type: 'data', streamId: 'test-stream-id', data: 'chunk1', done: true });

      const result = await stream.read();
      expect(result).toBe('chunk1');
      expect(stream.state).toBe('ended');
    });

    it('should handle onEnd callback when stream already ended', () => {
      const stream = new IframeReadableStream<string>(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      handler!({ type: 'end', streamId: 'test-stream-id' });

      const callback = jest.fn();
      stream.onEnd(callback);
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('IframeFileWritableStream', () => {
    it('should create file stream with filename', () => {
      const stream = new IframeFileWritableStream({
        filename: 'test.txt',
        mimeType: 'text/plain',
        size: 1024
      });

      expect(stream.type).toBe('file');
      expect(stream.filename).toBe('test.txt');
      expect(stream.mimeType).toBe('text/plain');
      expect(stream.size).toBe(1024);
    });
  });

  describe('IframeFileReadableStream', () => {
    let mockHandler: StreamMessageHandler;
    let registeredHandlers: Map<string, (data: any) => void>;

    beforeEach(() => {
      registeredHandlers = new Map();
      mockHandler = {
        registerStreamHandler: jest.fn((streamId, handler) => {
          registeredHandlers.set(streamId, handler);
        }),
        unregisterStreamHandler: jest.fn((streamId) => {
          registeredHandlers.delete(streamId);
        }),
        postMessage: jest.fn()
      };
    });

    it('should create file readable stream', () => {
      const stream = new IframeFileReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler,
        {
          filename: 'test.txt',
          mimeType: 'text/plain',
          size: 100
        }
      );

      expect(stream.type).toBe('file');
      expect(stream.filename).toBe('test.txt');
      expect(stream.mimeType).toBe('text/plain');
    });

    it('should decode binary data', async () => {
      const stream = new IframeFileReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      
      const testData = 'Hello, World!';
      const bytes = Uint8Array.from(Buffer.from(testData, 'utf8'));
      handler!({ type: 'data', streamId: 'test-stream-id', data: bytes, done: true });

      const result = await stream.read();
      expect(result).toBeInstanceOf(Uint8Array);
      
      // Decode to verify content (manually convert Uint8Array to string)
      let decoded = '';
      for (let i = 0; i < result.length; i++) {
        decoded += String.fromCharCode(result[i]);
      }
      expect(decoded).toBe(testData);
    });

    it('should read as Blob', async () => {
      const stream = new IframeFileReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler,
        { mimeType: 'text/plain' }
      );

      const handler = registeredHandlers.get('test-stream-id');
      const bytes = Uint8Array.from(Buffer.from('test', 'utf8'));
      handler!({ type: 'data', streamId: 'test-stream-id', data: bytes, done: true });

      const blob = await stream.readAsBlob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/plain');
    });

    it('should read as ArrayBuffer', async () => {
      const stream = new IframeFileReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler
      );

      const handler = registeredHandlers.get('test-stream-id');
      const bytes = Uint8Array.from(Buffer.from('test', 'utf8'));
      handler!({ type: 'data', streamId: 'test-stream-id', data: bytes, done: true });

      const buffer = await stream.readAsArrayBuffer();
      expect(buffer).toBeInstanceOf(ArrayBuffer);
    });

    it('should read as Data URL', async () => {
      const stream = new IframeFileReadableStream(
        'test-stream-id',
        'test-request-id',
        mockHandler,
        { mimeType: 'text/plain' }
      );

      const handler = registeredHandlers.get('test-stream-id');
      const bytes = Uint8Array.from(Buffer.from('test', 'utf8'));
      handler!({ type: 'data', streamId: 'test-stream-id', data: bytes, done: true });

      const dataUrl = await stream.readAsDataURL();
      expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    });

    it('should read as Text (utf-8)', async () => {
      const g: any = globalThis as any;
      const originalTextDecoder = g.TextDecoder;
      g.TextDecoder = undefined;
      try {
        const stream = new IframeFileReadableStream('test-stream-id', 'test-request-id', mockHandler, {
          mimeType: 'text/plain'
        });
        const handler = registeredHandlers.get('test-stream-id');
        const text = '你好, world!';
        const bytes = Uint8Array.from(Buffer.from(text, 'utf8'));
        handler!({ type: 'data', streamId: 'test-stream-id', data: bytes, done: true });

        const result = await stream.readAsText();
        expect(result).toBe(text);
      } finally {
        g.TextDecoder = originalTextDecoder;
      }
    });
  });

  describe('Type guards', () => {
    let mockHandler: StreamMessageHandler;

    beforeEach(() => {
      mockHandler = {
        registerStreamHandler: jest.fn(),
        unregisterStreamHandler: jest.fn(),
        postMessage: jest.fn()
      };
    });

    it('isIframeReadableStream should return true for IframeReadableStream', () => {
      const stream = new IframeReadableStream('id', 'reqId', mockHandler);
      expect(isIframeReadableStream(stream)).toBe(true);
    });

    it('isIframeReadableStream should return false for non-stream objects', () => {
      expect(isIframeReadableStream({})).toBe(false);
      expect(isIframeReadableStream(null)).toBe(false);
      expect(isIframeReadableStream('string')).toBe(false);
    });

    it('isIframeFileReadableStream should return true for IframeFileReadableStream', () => {
      const stream = new IframeFileReadableStream('id', 'reqId', mockHandler);
      expect(isIframeFileReadableStream(stream)).toBe(true);
    });

    it('isIframeFileReadableStream should return false for regular IframeReadableStream', () => {
      const stream = new IframeReadableStream('id', 'reqId', mockHandler);
      expect(isIframeFileReadableStream(stream)).toBe(false);
    });

    it('isIframeFileWritableStream should return true for IframeFileWritableStream', () => {
      const stream = new IframeFileWritableStream({
        filename: 'test.txt',
        mimeType: 'text/plain',
        next: async () => ({ data: new Uint8Array([1, 2, 3]), done: true })
      });
      expect(isIframeFileWritableStream(stream)).toBe(true);
    });

    it('isIframeFileWritableStream should return false for regular IframeWritableStream', () => {
      const stream = new IframeWritableStream();
      expect(isIframeFileWritableStream(stream)).toBe(false);
    });
  });
});
