import { MessageDispatcher } from '../message/dispatcher';
import { MessageChannel } from '../message/channel';
import { MessageRole, MessageType, ProtocolVersion } from '../constants';
import { createPostMessage } from '../utils';
import { MessageContext } from '../message/channel';

describe('MessageDispatcher', () => {
  let channel: MessageChannel;
  let dispatcher: MessageDispatcher;
  let mockHandler: jest.Mock;
  let mockContext: MessageContext;

  beforeEach(() => {
    channel = new MessageChannel();
    dispatcher = new MessageDispatcher(channel, MessageRole.CLIENT, 'instance-1');
    mockHandler = jest.fn();
    mockContext = {
      source: window,
      origin: 'https://example.com'
    };
  });

  afterEach(() => {
    dispatcher.destroy();
    channel.destroy();
  });

  describe('constructor', () => {
    it('should create dispatcher with channel and role', () => {
      expect(dispatcher.secretKey).toBeUndefined();
      expect(dispatcher.type).toBe('postMessage');
    });

    it('should create dispatcher with secretKey from channel', () => {
      const channelWithKey = new MessageChannel('test-key');
      const dispatcherWithKey = new MessageDispatcher(channelWithKey, MessageRole.SERVER);
      expect(dispatcherWithKey.secretKey).toBe('test-key');
      dispatcherWithKey.destroy();
      channelWithKey.destroy();
    });

    it('should create dispatcher with instanceId', () => {
      const dispatcherWithId = new MessageDispatcher(channel, MessageRole.CLIENT, 'custom-id');
      expect(dispatcherWithId).toBeDefined();
      dispatcherWithId.destroy();
    });
  });

  describe('reference counting', () => {
    it('should increment reference count', () => {
      expect(dispatcher.getRefCount()).toBe(0);
      dispatcher.addRef();
      expect(dispatcher.getRefCount()).toBe(1);
      dispatcher.addRef();
      expect(dispatcher.getRefCount()).toBe(2);
    });

    it('should decrement reference count', () => {
      dispatcher.addRef();
      dispatcher.addRef();
      expect(dispatcher.release()).toBe(1);
      expect(dispatcher.release()).toBe(0);
    });
  });

  describe('registerHandler', () => {
    it('should register handler with string matcher', () => {
      const unregister = dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(mockHandler).toHaveBeenCalledWith(message, mockContext);
      unregister();
    });

    it('should register handler with regex matcher', () => {
      const unregister = dispatcher.registerHandler(/^stream_/, mockHandler);
      
      const message = createPostMessage(MessageType.STREAM_START, 'req123', {
        body: { streamId: 'stream-1' },
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(mockHandler).toHaveBeenCalledWith(message, mockContext);
      unregister();
    });

    it('should register handler with function matcher', () => {
      const matcher = (type: string) => type.startsWith('stream_');
      const unregister = dispatcher.registerHandler(matcher, mockHandler);
      
      const message = createPostMessage(MessageType.STREAM_DATA, 'req123', {
        body: { streamId: 'stream-1' },
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(mockHandler).toHaveBeenCalledWith(message, mockContext);
      unregister();
    });

    it('should support priority ordering', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      dispatcher.registerHandler(MessageType.REQUEST, handler1, { priority: 1 });
      dispatcher.registerHandler(MessageType.REQUEST, handler2, { priority: 2 });
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      // Higher priority handler should be called first
      expect(handler2.mock.invocationCallOrder[0]).toBeLessThan(handler1.mock.invocationCallOrder[0]);
    });

    it('should support legacy priority API (number)', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      dispatcher.registerHandler(MessageType.REQUEST, handler1, 1);
      dispatcher.registerHandler(MessageType.REQUEST, handler2, 2);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(handler2.mock.invocationCallOrder[0]).toBeLessThan(handler1.mock.invocationCallOrder[0]);
    });

    it('should return unregister function', () => {
      const unregister = dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      unregister();
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('unregisterHandler', () => {
    it('should unregister handler by function reference', () => {
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      dispatcher.unregisterHandler(mockHandler);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('role-based filtering', () => {
    it('should only process messages from opposite role (client receives from server)', () => {
      const clientDispatcher = new MessageDispatcher(channel, MessageRole.CLIENT);
      clientDispatcher.registerHandler(MessageType.RESPONSE, mockHandler);
      
      // Message from server (should be processed)
      const serverMessage = createPostMessage(MessageType.RESPONSE, 'req123', {
        role: MessageRole.SERVER
      });
      
      clientDispatcher['dispatchMessage'](serverMessage, mockContext);
      expect(mockHandler).toHaveBeenCalled();
      
      // Message from client (should be ignored)
      const clientMessage = createPostMessage(MessageType.RESPONSE, 'req124', {
        role: MessageRole.CLIENT
      });
      
      mockHandler.mockClear();
      clientDispatcher['dispatchMessage'](clientMessage, mockContext);
      expect(mockHandler).not.toHaveBeenCalled();
      
      clientDispatcher.destroy();
    });

    it('should only process messages from opposite role (server receives from client)', () => {
      const serverDispatcher = new MessageDispatcher(channel, MessageRole.SERVER);
      serverDispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      // Message from client (should be processed)
      const clientMessage = createPostMessage(MessageType.REQUEST, 'req123', {
        role: MessageRole.CLIENT
      });
      
      serverDispatcher['dispatchMessage'](clientMessage, mockContext);
      expect(mockHandler).toHaveBeenCalled();
      
      // Message from server (should be ignored)
      const serverMessage = createPostMessage(MessageType.REQUEST, 'req124', {
        role: MessageRole.SERVER
      });
      
      mockHandler.mockClear();
      serverDispatcher['dispatchMessage'](serverMessage, mockContext);
      expect(mockHandler).not.toHaveBeenCalled();
      
      serverDispatcher.destroy();
    });

    it('should process messages without role (backward compatibility)', () => {
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      delete (message as any).role;
      
      dispatcher['dispatchMessage'](message, mockContext);
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('version validation', () => {
    it('should validate protocol version', () => {
      const versionValidator = jest.fn((version: number) => version >= ProtocolVersion.MIN_SUPPORTED);
      const onVersionError = jest.fn();
      
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler, {
        versionValidator,
        onVersionError
      });
      
      // Valid version
      const validMessage = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      (validMessage as any).__requestIframe__ = ProtocolVersion.CURRENT;
      
      dispatcher['dispatchMessage'](validMessage, mockContext);
      expect(mockHandler).toHaveBeenCalled();
      expect(onVersionError).not.toHaveBeenCalled();
      
      // Invalid version
      const invalidMessage = createPostMessage(MessageType.REQUEST, 'req124', {
        path: 'test',
        role: MessageRole.SERVER
      });
      (invalidMessage as any).__requestIframe__ = 0; // Invalid version
      
      mockHandler.mockClear();
      dispatcher['dispatchMessage'](invalidMessage, mockContext);
      expect(mockHandler).not.toHaveBeenCalled();
      expect(onVersionError).toHaveBeenCalledWith(
        invalidMessage,
        mockContext,
        0
      );
    });

    it('should continue to other handlers when version validation fails', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      dispatcher.registerHandler(MessageType.REQUEST, handler1, {
        versionValidator: () => false
      });
      dispatcher.registerHandler(MessageType.REQUEST, handler2);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('handledBy context', () => {
    it('should skip processing if message already handled', () => {
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      const context: MessageContext = {
        ...mockContext,
        handledBy: 'other-instance'
      };
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, context);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should stop processing after handler sets handledBy', () => {
      const handler1 = jest.fn((data, context) => {
        context.handledBy = 'instance-1';
      });
      const handler2 = jest.fn();
      
      dispatcher.registerHandler(MessageType.REQUEST, handler1);
      dispatcher.registerHandler(MessageType.REQUEST, handler2);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    /** stream_data per-frame ACK is handled at stream routing layer, not by MessageDispatcher */
  });

  describe('auto-ack payload size limit', () => {
    it('should fallback to {id} when echoed ack payload is too large', () => {
      const postSpy = jest.spyOn(window, 'postMessage').mockImplementation();

      dispatcher.registerHandler(MessageType.REQUEST, (_data, context) => {
        context.accepted = true;
        context.handledBy = 'instance-1';
      });

      const bigAck = { id: 'ack-1', meta: 'x'.repeat(6000) };
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER,
        requireAck: true,
        ack: bigAck
      } as any);

      dispatcher['dispatchMessage'](message, mockContext);

      const ackCall = postSpy.mock.calls.find((c) => (c[0] as any)?.type === MessageType.ACK);
      expect(ackCall).toBeDefined();
      expect((ackCall as any)[0].ack).toEqual({ id: 'ack-1' });

      postSpy.mockRestore();
    });

    it('should respect configured maxMetaLength', () => {
      const postSpy = jest.spyOn(window, 'postMessage').mockImplementation();

      dispatcher.setAutoAckLimits({ maxMetaLength: 1 });
      dispatcher.registerHandler(MessageType.REQUEST, (_data, context) => {
        context.accepted = true;
        context.handledBy = 'instance-1';
      });

      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER,
        requireAck: true,
        ack: { id: 'ack-1', meta: 'xx' }
      } as any);

      dispatcher['dispatchMessage'](message, mockContext);

      const ackCall = postSpy.mock.calls.find((c) => (c[0] as any)?.type === MessageType.ACK);
      expect(ackCall).toBeDefined();
      expect((ackCall as any)[0].ack).toEqual({ id: 'ack-1' });

      postSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle handler errors gracefully', () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      dispatcher.registerHandler(MessageType.REQUEST, errorHandler);
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      
      expect(errorHandler).toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalled(); // Other handlers should still be called
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[request-iframe] Handler error:',
        expect.any(Error)
      );
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('send', () => {
    it('should send message with role and creatorId', () => {
      const targetWindow = {
        postMessage: jest.fn()
      } as any;
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      delete (message as any).role;
      delete (message as any).creatorId;
      
      const ok = dispatcher.send(targetWindow, message, 'https://example.com');
      
      expect(message.role).toBe(MessageRole.CLIENT);
      expect(message.creatorId).toBe('instance-1');
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });

    it('should not override existing role and creatorId', () => {
      const targetWindow = {
        postMessage: jest.fn()
      } as any;
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER,
        creatorId: 'custom-id'
      });
      
      const ok = dispatcher.send(targetWindow, message, 'https://example.com');
      
      expect(message.role).toBe(MessageRole.SERVER);
      expect(message.creatorId).toBe('custom-id');
      expect(ok).toBe(true);
    });

    it('should use default origin * when not specified', () => {
      const targetWindow = {
        postMessage: jest.fn()
      } as any;
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      const ok = dispatcher.send(targetWindow, message);
      
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalledWith(
        expect.any(Object),
        '*'
      );
    });
  });

  describe('sendMessage', () => {
    it('should create and send message with role and creatorId', () => {
      const targetWindow = {
        postMessage: jest.fn()
      } as any;
      
      const ok = dispatcher.sendMessage(
        targetWindow,
        'https://example.com',
        MessageType.REQUEST,
        'req123',
        {
          path: 'test',
          body: { param: 'value' }
        }
      );
      
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          requestId: 'req123',
          path: 'test',
          body: { param: 'value' },
          role: MessageRole.CLIENT,
          creatorId: 'instance-1'
        }),
        'https://example.com'
      );
    });
  });

  describe('prefixPath', () => {
    it('should delegate to channel prefixPath', () => {
      const channelWithKey = new MessageChannel('test-key');
      const dispatcherWithKey = new MessageDispatcher(channelWithKey, MessageRole.CLIENT);
      
      expect(dispatcherWithKey.prefixPath('test')).toBe('test-key:test');
      
      dispatcherWithKey.destroy();
      channelWithKey.destroy();
    });
  });

  describe('getChannel', () => {
    it('should return underlying channel', () => {
      expect(dispatcher.getChannel()).toBe(channel);
    });
  });

  describe('destroy', () => {
    it('should clear handlers and remove receiver', () => {
      dispatcher.registerHandler(MessageType.REQUEST, mockHandler);
      dispatcher.destroy();
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        role: MessageRole.SERVER
      });
      
      dispatcher['dispatchMessage'](message, mockContext);
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
