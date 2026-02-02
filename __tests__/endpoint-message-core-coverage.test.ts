import { MessageType, MessageRole, ProtocolVersion, Messages } from '../src/constants';
import { RequestIframeEndpointInbox } from '../src/endpoint/infra/inbox';
import { createPostMessage } from '../src/utils/protocol';

describe('coverage: endpoint/infra/inbox', () => {
  it('should handle ping/pong + version error + response branches', () => {
    const createCtx = (params: { origin: string; source?: any; acceptedBy?: string; handledBy?: any }) => {
      const ctx: any = {
        origin: params.origin,
        source: params.source,
        acceptedBy: params.acceptedBy,
        handledBy: params.handledBy
      };
      ctx.markHandledBy = (handledBy: string) => {
        if (!ctx.handledBy) ctx.handledBy = handledBy;
      };
      ctx.markAcceptedBy = (handledBy: string) => {
        if (!ctx.acceptedBy) ctx.acceptedBy = handledBy;
        ctx.markHandledBy(handledBy);
      };
      ctx.markDoneBy = (doneBy: string) => {
        ctx.doneBy = doneBy;
      };
      ctx.getStage = () => {
        if (ctx.doneBy) return 'done';
        if (ctx.acceptedBy) return 'accepted';
        if (ctx.handledBy) return 'handling';
        return 'pending';
      };
      return ctx;
    };

    const handlers: Record<string, { fn: any; options: any }> = {};

    const pendingMaps = new Map<string, Map<string, any>>();
    const pending = {
      map: (name: string) => {
        const m = pendingMaps.get(name) ?? new Map<string, any>();
        pendingMaps.set(name, m);
        return m;
      },
      set: (name: string, key: string, value: any) => pending.map(name).set(key, value),
      get: (name: string, key: string) => pending.map(name).get(key),
      delete: (name: string, key: string) => pending.map(name).delete(key)
    };

    const warnOnceKeys = new Set<string>();
    const core: any = {
      instanceId: undefined,
      isOpen: false,
      pending,
      messageDispatcher: { sendMessage: jest.fn() },
      createHandlerOptions: (onVersionError: any) => ({ onVersionError, versionValidator: () => true }),
      registerHandler: (matcher: any, fn: any, options: any) => {
        if (typeof matcher === 'string') {
          handlers[matcher] = { fn, options };
        }
      },
      warnOnce: (key: string, fn: () => void) => {
        if (warnOnceKeys.has(key)) return;
        warnOnceKeys.add(key);
        fn();
      },
      isOriginAllowedBy: (origin: string, data: any, ctx: any, expectedOrigin?: string) => {
        void data;
        void ctx;
        if (!expectedOrigin) return true;
        return origin === expectedOrigin;
      }
    };

    const inbox = new RequestIframeEndpointInbox(core as any);
    inbox.registerHandlers();

    /** ping: source missing -> no sendMessage */
    handlers[MessageType.PING].fn(createPostMessage(MessageType.PING, 'p1', { role: MessageRole.SERVER }) as any, {
      origin: '*',
      source: undefined
    } as any);
    expect(core.messageDispatcher.sendMessage).not.toHaveBeenCalled();

    /** ping: source exists -> reply pong */
    handlers[MessageType.PING].fn(
      createPostMessage(MessageType.PING, 'p2', { role: MessageRole.SERVER }) as any,
      createCtx({ origin: '*', source: window, acceptedBy: undefined, handledBy: undefined })
    );
    expect(core.messageDispatcher.sendMessage).toHaveBeenCalled();

    /** pending missing + closed -> warnOnce path */
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => void 0);
    handlers[MessageType.ACK].fn(createPostMessage(MessageType.ACK, 'nope', { role: MessageRole.SERVER }) as any, {
      origin: 'https://x'
    } as any);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    /** register pending and test origin mismatch ignored */
    const resolve = jest.fn();
    const reject = jest.fn();
    inbox.registerPendingRequest('r1', resolve, reject, 'https://allowed');
    handlers[MessageType.RESPONSE].fn(
      createPostMessage(MessageType.RESPONSE, 'r1', { role: MessageRole.SERVER, data: 1 }) as any,
      createCtx({ origin: 'https://blocked', acceptedBy: undefined, handledBy: undefined })
    );
    expect(resolve).not.toHaveBeenCalled();

    /** ack/async/stream_start should NOT delete pending */
    handlers[MessageType.ACK].fn(
      createPostMessage(MessageType.ACK, 'r1', { role: MessageRole.SERVER }) as any,
      createCtx({ origin: 'https://allowed', acceptedBy: undefined, handledBy: undefined })
    );
    expect(resolve).toHaveBeenCalled();
    expect(pending.get(RequestIframeEndpointInbox.PENDING_REQUESTS, 'r1')).toBeDefined();

    handlers[MessageType.STREAM_START].fn(
      createPostMessage(MessageType.STREAM_START, 'r1', { role: MessageRole.SERVER, body: { streamId: 's' } }) as any,
      createCtx({ origin: 'https://allowed', acceptedBy: undefined, handledBy: undefined })
    );
    expect(pending.get(RequestIframeEndpointInbox.PENDING_REQUESTS, 'r1')).toBeDefined();

    /** pong should delete pending if matches */
    handlers[MessageType.PONG].fn(
      createPostMessage(MessageType.PONG, 'r1', { role: MessageRole.SERVER }) as any,
      createCtx({ origin: 'https://allowed', acceptedBy: undefined, handledBy: undefined })
    );
    expect(pending.get(RequestIframeEndpointInbox.PENDING_REQUESTS, 'r1')).toBeUndefined();

    /** version error should reject and delete pending */
    inbox.registerPendingRequest('v1', resolve, reject);
    handlers[MessageType.RESPONSE].options.onVersionError(
      createPostMessage(MessageType.RESPONSE, 'v1', { __requestIframe__: ProtocolVersion.MIN_SUPPORTED - 1 } as any) as any,
      {} as any,
      ProtocolVersion.MIN_SUPPORTED - 1
    );
    expect(reject).toHaveBeenCalled();

    /** version error with missing pending is noop */
    handlers[MessageType.RESPONSE].options.onVersionError(
      createPostMessage(MessageType.RESPONSE, 'v2', { __requestIframe__: ProtocolVersion.MIN_SUPPORTED - 1 } as any) as any,
      {} as any,
      ProtocolVersion.MIN_SUPPORTED - 1
    );

    /** smoke: ensure message string used */
    expect(Messages.CLIENT_SERVER_IGNORED_MESSAGE_WHEN_CLOSED).toBeDefined();
  });
});

