import { MessageChannel, ChannelType, MessageContext } from '../src/message/channel';
import { createPostMessage } from '../src/utils';
import { MessageType, MessageRole } from '../src/constants';

describe('MessageChannel', () => {
  let channel: MessageChannel;
  let mockReceiver: jest.Mock;

  beforeEach(() => {
    mockReceiver = jest.fn();
    channel = new MessageChannel();
  });

  afterEach(() => {
    channel.destroy();
  });

  describe('constructor', () => {
    it('should create channel with default type', () => {
      expect(channel.type).toBe(ChannelType.POST_MESSAGE);
    });

    it('should create channel with secretKey', () => {
      const channelWithKey = new MessageChannel('test-key');
      expect(channelWithKey.secretKey).toBe('test-key');
      channelWithKey.destroy();
    });

    it('should add message event listener', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      const testChannel = new MessageChannel();
      expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
      testChannel.destroy();
      addEventListenerSpy.mockRestore();
    });
  });

  describe('addReceiver and removeReceiver', () => {
    it('should add receiver callback', () => {
      channel.addReceiver(mockReceiver);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      // Wait for async message handling
      setTimeout(() => {
        expect(mockReceiver).toHaveBeenCalled();
      }, 10);
    });

    it('should remove receiver callback', () => {
      channel.addReceiver(mockReceiver);
      channel.removeReceiver(mockReceiver);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      // Wait for async message handling
      setTimeout(() => {
        expect(mockReceiver).not.toHaveBeenCalled();
      }, 10);
    });

    it('should support multiple receivers', () => {
      const receiver1 = jest.fn();
      const receiver2 = jest.fn();
      
      channel.addReceiver(receiver1);
      channel.addReceiver(receiver2);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      // Wait for async message handling
      setTimeout(() => {
        expect(receiver1).toHaveBeenCalled();
        expect(receiver2).toHaveBeenCalled();
      }, 10);
    });
  });

  describe('reference counting', () => {
    it('should increment reference count', () => {
      expect(channel.getRefCount()).toBe(0);
      channel.addRef();
      expect(channel.getRefCount()).toBe(1);
      channel.addRef();
      expect(channel.getRefCount()).toBe(2);
    });

    it('should decrement reference count', () => {
      channel.addRef();
      channel.addRef();
      expect(channel.release()).toBe(1);
      expect(channel.release()).toBe(0);
    });
  });

  describe('message filtering', () => {
    it('should filter messages by secretKey', () => {
      const channelWithKey = new MessageChannel('test-key');
      channelWithKey.addReceiver(mockReceiver);
      
      // Message with matching secretKey
      const validMessage = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test',
        secretKey: 'test-key'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: validMessage,
          origin: 'https://example.com'
        })
      );

      // Message with different secretKey
      const invalidMessage = createPostMessage(MessageType.REQUEST, 'req124', {
        path: 'test',
        secretKey: 'other-key'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: invalidMessage,
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(mockReceiver).toHaveBeenCalledTimes(1);
        expect(mockReceiver).toHaveBeenCalledWith(
          validMessage,
          expect.objectContaining({
            origin: 'https://example.com'
          })
        );
      }, 10);

      channelWithKey.destroy();
    });

    it('should filter messages without secretKey when channel has secretKey', () => {
      const channelWithKey = new MessageChannel('test-key');
      channelWithKey.addReceiver(mockReceiver);
      
      // Message without secretKey
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      delete (message as any).secretKey;
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(mockReceiver).not.toHaveBeenCalled();
      }, 10);

      channelWithKey.destroy();
    });

    it('should accept messages without secretKey when channel has no secretKey', () => {
      channel.addReceiver(mockReceiver);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      delete (message as any).secretKey;
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(mockReceiver).toHaveBeenCalled();
      }, 10);
    });

    it('should ignore invalid postMessage format', () => {
      channel.addReceiver(mockReceiver);
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { invalid: 'message' },
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(mockReceiver).not.toHaveBeenCalled();
      }, 10);
    });
  });

  describe('send', () => {
    it('should send message to target window', () => {
      const targetWindow = {
        closed: false,
        document: {},
        postMessage: jest.fn()
      } as any;
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      const ok = channel.send(targetWindow, message, 'https://example.com');
      
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalledWith(
        message,
        'https://example.com'
      );
    });

    it('should use default origin * when not specified', () => {
      const targetWindow = {
        closed: false,
        document: {},
        postMessage: jest.fn()
      } as any;
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      const ok = channel.send(targetWindow, message);
      
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalledWith(
        message,
        '*'
      );
    });
  });

  describe('sendMessage', () => {
    it('should create and send message', () => {
      const targetWindow = {
        closed: false,
        document: {},
        postMessage: jest.fn()
      } as any;
      
      const ok = channel.sendMessage(
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
          __requestIframe__: 2,
          type: 'request',
          requestId: 'req123',
          path: 'test',
          body: { param: 'value' },
          secretKey: undefined
        }),
        'https://example.com'
      );
    });

    it('should include secretKey in message', () => {
      const channelWithKey = new MessageChannel('test-key');
      const targetWindow = {
        closed: false,
        document: {},
        postMessage: jest.fn()
      } as any;
      
      const ok = channelWithKey.sendMessage(
        targetWindow,
        'https://example.com',
        MessageType.REQUEST,
        'req123',
        { path: 'test' }
      );
      
      expect(ok).toBe(true);
      expect(targetWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          secretKey: 'test-key'
        }),
        'https://example.com'
      );

      channelWithKey.destroy();
    });
  });

  describe('prefixPath', () => {
    it('should add secretKey prefix when secretKey exists', () => {
      const channelWithKey = new MessageChannel('test-key');
      expect(channelWithKey.prefixPath('test')).toBe('test-key:test');
      channelWithKey.destroy();
    });

    it('should return path as-is when no secretKey', () => {
      expect(channel.prefixPath('test')).toBe('test');
    });
  });

  describe('extractContext', () => {
    it('should extract context from MessageEvent', () => {
      channel.addReceiver(mockReceiver);
      
      const sourceWindow = window;
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com',
          source: sourceWindow
        })
      );

      setTimeout(() => {
        expect(mockReceiver).toHaveBeenCalledWith(
          message,
          expect.objectContaining({
            source: sourceWindow,
            origin: 'https://example.com'
          })
        );
      }, 10);
    });
  });

  describe('error handling', () => {
    it('should handle receiver errors gracefully', () => {
      const errorReceiver = jest.fn(() => {
        throw new Error('Receiver error');
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      channel.addReceiver(errorReceiver);
      channel.addReceiver(mockReceiver);
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(errorReceiver).toHaveBeenCalled();
        expect(mockReceiver).toHaveBeenCalled(); // Other receivers should still be called
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[request-iframe] Receiver error:',
          expect.any(Error)
        );
        consoleErrorSpy.mockRestore();
      }, 10);
    });
  });

  describe('destroy', () => {
    it('should remove event listener', () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
      channel.destroy();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });

    it('should clear receivers', () => {
      channel.addReceiver(mockReceiver);
      channel.destroy();
      
      const message = createPostMessage(MessageType.REQUEST, 'req123', {
        path: 'test'
      });
      
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: 'https://example.com'
        })
      );

      setTimeout(() => {
        expect(mockReceiver).not.toHaveBeenCalled();
      }, 10);
    });
  });
});
