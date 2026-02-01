import type { OriginMatcher, OriginValidator, PostMessageData } from '../types';
import type { HandlerOptions, MessageContext, VersionValidator } from '../message';
import type { MessageRoleValue } from '../constants';
import { MessageType } from '../constants';
import { matchOrigin } from '../utils/origin';
import { RequestIframeEndpointHub } from './infra/hub';
import { RequestIframeEndpointInbox } from './infra/inbox';
import { RequestIframeEndpointStreamRouter } from './stream/router';
import { RequestIframeEndpointHeartbeat } from './heartbeat/heartbeat';
import { createPingResponder } from './heartbeat/ping';
import { createReadableStreamFromStart } from './stream/factory';
import type { StreamStartInfo } from './stream/factory';
import { createStreamMessageHandler } from './stream/handler';
import type { IframeReadableStream, IframeFileReadableStream, StreamMessageHandler } from '../stream';
import type { RequestIframeEndpointOutbox } from './infra/outbox';

/**
 * RequestIframeEndpointFacade
 *
 * 将 endpoint 常用的“装配/组合逻辑”统一收敛到一个地方，供 client/server 作为 thin wrapper 复用：
 * - hub（MessageDispatcher 生命周期）
 * - inbox（ACK/ASYNC/RESPONSE/ERROR/PING/PONG/STREAM_START 入站处理，可选）
 * - streamRouter（stream_* 路由）
 * - heartbeat（ping -> wait pong，可选）
 * - originValidator（allowedOrigins/validateOrigin 的统一构建）
 */
export class RequestIframeEndpointFacade {
  public readonly hub: RequestIframeEndpointHub;
  public readonly streamRouter: RequestIframeEndpointStreamRouter;
  public readonly inbox?: RequestIframeEndpointInbox;
  public readonly heartbeat?: RequestIframeEndpointHeartbeat;
  public readonly originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean;
  private readonly openHooks: Array<() => void> = [];

  public constructor(params: {
    role: MessageRoleValue;
    instanceId: string;
    secretKey?: string;
    versionValidator?: VersionValidator;
    autoAckMaxMetaLength?: number;
    autoAckMaxIdLength?: number;
    /**
     * 自定义 handler 注册逻辑（通常用于 server：REQUEST/ACK/STREAM_START 等）。
     * 如果同时提供 inbox，则优先使用 inbox.registerHandlers。
     */
    registerHandlers?: () => void;
    /**
     * 是否创建 inbox（通常用于 client：入站消息处理 + pending 驱动）。
     */
    inbox?: {
      versionValidator?: VersionValidator;
    };
    /**
     * streamRouter handledBy（默认 instanceId）。
     */
    streamRouter?: {
      handledBy?: string;
    };
    /**
     * 是否创建 heartbeat（通常用于 server：pingClient/handlePong）。
     */
    heartbeat?: {
      pendingBucket: string;
      handledBy: string;
      isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
      warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
    };
    originValidator?: {
      allowedOrigins?: OriginMatcher;
      validateOrigin?: OriginValidator;
    };
  }) {
    this.hub = new RequestIframeEndpointHub(params.role, params.instanceId, {
      secretKey: params.secretKey,
      versionValidator: params.versionValidator,
      autoAckMaxMetaLength: params.autoAckMaxMetaLength,
      autoAckMaxIdLength: params.autoAckMaxIdLength
    });

    this.streamRouter = new RequestIframeEndpointStreamRouter({ handledBy: params.streamRouter?.handledBy ?? params.instanceId });

    this.originValidator = RequestIframeEndpointFacade.buildOriginValidator(params.originValidator);

    /**
     * Facade is the infrastructure owner: always register handlers via facade hooks.
     */
    this.hub.setRegisterHandlers(() => {
      this.openHooks.forEach((fn) => fn());
    });

    if (params.heartbeat) {
      this.heartbeat = new RequestIframeEndpointHeartbeat({
        hub: this.hub,
        pendingBucket: params.heartbeat.pendingBucket,
        handledBy: params.heartbeat.handledBy,
        isOriginAllowed: params.heartbeat.isOriginAllowed,
        warnMissingPendingWhenClosed: params.heartbeat.warnMissingPendingWhenClosed
      });
    }

    if (params.inbox) {
      this.inbox = new RequestIframeEndpointInbox(this.hub, params.inbox.versionValidator);
    }

    if (params.registerHandlers) {
      this.onOpen(params.registerHandlers);
    }
  }

  /**
   * Add a handler registration hook that will run on core.open().
   */
  public onOpen(fn: () => void): void {
    this.openHooks.push(fn);
  }

  private isOriginAllowedByValidator(origin: string, data: PostMessageData, context: MessageContext): boolean {
    if (!this.originValidator) return true;
    try {
      return this.originValidator(origin, data, context);
    } catch {
      return false;
    }
  }

  /**
   * Register client-side base handlers:
   * - ACK/PONG: resolve isConnect waiter (ping from client to server)
   *
   * Note: inbox must already be created for request/response pending handling.
   */
  public registerClientBaseHandlers(params: {
    handledBy: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
  }): void {
    this.onOpen(() => {
      const baseHandlerOptions = this.hub.createHandlerOptions(() => {
        /** ignore version errors for base infra */
      });

      /**
       * isConnect waiter handlers:
       * - inbox may also have ACK handler, but it won't mark handledBy if missing pending,
       *   so we can still catch isConnect ACK here.
       */
      this.hub.registerHandler(
        MessageType.ACK,
        (data, context) => {
          this.handleIsConnectAck(data, context, params);
        },
        baseHandlerOptions
      );
      this.hub.registerHandler(
        MessageType.PONG,
        (data, context) => {
          this.handleIsConnectPong(data, context, params);
        },
        baseHandlerOptions
      );
    });
  }

  /**
   * Register client-side stream callback handlers:
   * - stream_* (except stream_start) -> core.getStreamCallback()
   *
   * This makes stream routing pluggable and owned by the facade.
   */
  public registerClientStreamCallbackHandlers(params: { handlerOptions: HandlerOptions }): void {
    this.onOpen(() => {
      this.hub.registerHandler(
        (type: string) => type.startsWith('stream_') && type !== MessageType.STREAM_START,
        (data: PostMessageData, context: MessageContext) => this.hub.getStreamCallback()?.(data, context),
        params.handlerOptions
      );
    });
  }

  /**
   * Enable default stream routing: dispatch stream_* messages to streamRouter.
   */
  public enableStreamRouterCallback(params?: {
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
  }): void {
    this.hub.setStreamCallback((data, context) => {
      this.dispatchStreamMessage(data, context, { isOriginAllowed: params?.isOriginAllowed });
    });
  }

  public disableStreamRouterCallback(): void {
    this.hub.setStreamCallback(undefined);
  }

  /**
   * Register server-side base handlers:
   * - PING/PONG (heartbeat)
   * - ACK (receipt confirmation waiter)
   * - STREAM_START + stream_* routing (request-body stream)
   *
   * Server wrapper should still register REQUEST handler itself.
   */
  public registerServerBaseHandlers(params: {
    handlerOptions: HandlerOptions;
    handledBy: string;
    includeTargetIdInPong?: boolean;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
    pendingAckBucket: string;
    pendingStreamStartBucket: string;
    expectedStreamStartRole: MessageRoleValue;
  }): void {
    this.registerPingResponderHandler({
      handlerOptions: params.handlerOptions,
      handledBy: params.handledBy,
      includeTargetIdInPong: params.includeTargetIdInPong,
      isOriginAllowed: params.isOriginAllowed
    });
    this.registerHeartbeatPongHandler({ handlerOptions: params.handlerOptions });
    this.registerAckWaiterHandler({
      handlerOptions: params.handlerOptions,
      pendingBucket: params.pendingAckBucket,
      handledBy: params.handledBy,
      isOriginAllowed: params.isOriginAllowed,
      warnMissingPendingWhenClosed: params.warnMissingPendingWhenClosed
    });
    this.registerStreamHandlers({
      handlerOptions: params.handlerOptions,
      expectedRole: params.expectedStreamStartRole,
      pendingBucket: params.pendingStreamStartBucket,
      isOriginAllowed: params.isOriginAllowed,
      warnMissingPendingWhenClosed: params.warnMissingPendingWhenClosed
    });
  }

  /**
   * Register PING responder (reply PONG).
   */
  public registerPingResponderHandler(params: {
    handlerOptions: HandlerOptions;
    handledBy: string;
    includeTargetIdInPong?: boolean;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
  }): void {
    this.onOpen(() => {
      this.hub.registerHandler(
        MessageType.PING,
        (data, context) => {
          this.handlePing(data, context, {
            handledBy: params.handledBy,
            includeTargetId: params.includeTargetIdInPong,
            isOriginAllowed: params.isOriginAllowed
          });
        },
        params.handlerOptions
      );
    });
  }

  /**
   * Register PONG handler for heartbeat waiter (if heartbeat is configured).
   */
  public registerHeartbeatPongHandler(params: { handlerOptions: HandlerOptions }): void {
    this.onOpen(() => {
      this.hub.registerHandler(
        MessageType.PONG,
        (data, context) => {
          this.handlePong(data, context);
        },
        params.handlerOptions
      );
    });
  }

  /**
   * Register ACK handler for receipt confirmation waiters.
   */
  public registerAckWaiterHandler(params: {
    handlerOptions: HandlerOptions;
    pendingBucket: string;
    handledBy: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
  }): void {
    this.onOpen(() => {
      this.hub.registerHandler(
        MessageType.ACK,
        (data, context) => {
          this.handleAck({
            data,
            context,
            pendingBucket: params.pendingBucket,
            handledBy: params.handledBy,
            isOriginAllowed: params.isOriginAllowed,
            warnMissingPendingWhenClosed: params.warnMissingPendingWhenClosed
          });
        },
        params.handlerOptions
      );
    });
  }

  /**
   * Register stream handlers (STREAM_START + stream_* routing).
   */
  public registerStreamHandlers(params: {
    handlerOptions: HandlerOptions;
    expectedRole: MessageRoleValue;
    pendingBucket: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
  }): void {
    this.onOpen(() => {
      const isOriginAllowed = params.isOriginAllowed;
      this.hub.registerHandler(
        MessageType.STREAM_START,
        (data, context) => {
          this.handleStreamStart({
            data,
            context,
            expectedRole: params.expectedRole,
            pendingBucket: params.pendingBucket,
            isOriginAllowed,
            warnMissingPendingWhenClosed: params.warnMissingPendingWhenClosed
          });
        },
        params.handlerOptions
      );
      this.hub.registerHandler(
        (type: string) => type.startsWith('stream_') && type !== MessageType.STREAM_START,
        (data, context) => {
          this.dispatchStreamMessage(data, context, { isOriginAllowed });
        },
        params.handlerOptions
      );
    });
  }

  /**
   * Server-side: register a waiter for an incoming stream_start (request-body stream handshake).
   *
   * This centralizes:
   * - pending map bookkeeping
   * - timeout cleanup
   * - STREAM_START_TIMEOUT error response hook
   */
  public registerIncomingStreamStartWaiter(params: {
    pendingBucket: string;
    requestId: string;
    streamId: string;
    timeoutMs: number;
    targetWindow: Window;
    targetOrigin: string;
    onTimeout: () => void;
    continue: (payload: { stream: any; info: any; data: PostMessageData; context: MessageContext }) => void;
  }): void {
    const timeoutId = this.hub.pending.setTimeout(() => {
      const pending = this.hub.pending.get<string, any>(params.pendingBucket, params.requestId);
      if (!pending) return;
      this.hub.pending.delete(params.pendingBucket, params.requestId);
      params.onTimeout();
    }, params.timeoutMs);

    this.hub.pending.set(params.pendingBucket, params.requestId, {
      streamId: params.streamId,
      timeoutId,
      targetWindow: params.targetWindow,
      targetOrigin: params.targetOrigin,
      continue: params.continue
    });
  }

  /**
   * Handle incoming PING and reply PONG.
   *
   * This is a base infrastructure capability for all endpoints.
   */
  public handlePing(
    data: PostMessageData,
    context: MessageContext,
    params: {
      handledBy: string;
      includeTargetId?: boolean;
      isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    }
  ): void {
    if (!context.source) return;
    if (params.isOriginAllowed && !params.isOriginAllowed(data, context)) return;
    createPingResponder({
      hub: this.hub,
      handledBy: params.handledBy,
      includeTargetId: params.includeTargetId
    })(data, context);
  }

  /**
   * Handle incoming PONG for facade heartbeat waiter (if configured).
   */
  public handlePong(data: PostMessageData, context: MessageContext): void {
    this.heartbeat?.handlePong(data, context);
  }

  /**
   * Ping a peer and resolve true when PONG arrives (requires heartbeat configured).
   */
  public pingPeer(
    targetWindow: Window,
    targetOrigin: string,
    timeoutMs: number,
    targetId?: string
  ): Promise<boolean> {
    if (!this.heartbeat) {
      return Promise.resolve(false);
    }
    const peer = this.hub.createOutbox(targetWindow, targetOrigin, targetId);
    return this.heartbeat.ping(peer, timeoutMs, targetId);
  }

  /**
   * Client-side "isConnect" ping helper (requires inbox configured).
   *
   * - Sends PING(requireAck=true)
   * - Resolves true when ACK or PONG arrives, false on timeout
   */
  public pingIsConnect(params: {
    peer: RequestIframeEndpointOutbox;
    timeoutMs: number;
    targetOrigin: string;
    targetId?: string;
    onPeerId?: (peerId?: string) => void;
  }): Promise<boolean> {
    const requestId = `ping_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timeoutId = this.hub.pending.setTimeout(() => {
        this.hub.pending.delete(RequestIframeEndpointFacade.PENDING_IS_CONNECT, requestId);
        resolve(false);
      }, params.timeoutMs);
      this.hub.pending.set(RequestIframeEndpointFacade.PENDING_IS_CONNECT, requestId, {
        resolve,
        timeoutId,
        targetOrigin: params.targetOrigin,
        onPeerId: params.onPeerId
      });
      params.peer.sendMessage(MessageType.PING, requestId, { requireAck: true, targetId: params.targetId });
    });
  }

  private static readonly PENDING_IS_CONNECT = 'endpoint:pendingIsConnect';

  /**
   * Pending ACK waiter bucket entry.
   */
  private static readonly DEFAULT_PENDING_ACKS_BUCKET = 'endpoint:pendingAcks';

  /**
   * Register an ACK waiter (used by server response requireAck).
   */
  public registerPendingAck(params: {
    requestId: string;
    timeoutMs: number;
    pendingBucket?: string;
    resolve: (received: boolean, ack?: any) => void;
  }): void {
    const bucket = params.pendingBucket ?? RequestIframeEndpointFacade.DEFAULT_PENDING_ACKS_BUCKET;
    const timeoutId = this.hub.pending.setTimeout(() => {
      this.hub.pending.delete(bucket, params.requestId);
      params.resolve(false);
    }, params.timeoutMs);
    this.hub.pending.set(bucket, params.requestId, { resolve: params.resolve, timeoutId });
  }

  /**
   * Handle incoming ACK for a registered waiter.
   */
  public handleAck(params: {
    data: PostMessageData;
    context: MessageContext;
    pendingBucket?: string;
    handledBy: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
  }): void {
    const bucket = params.pendingBucket ?? RequestIframeEndpointFacade.DEFAULT_PENDING_ACKS_BUCKET;
    if (params.isOriginAllowed && !params.isOriginAllowed(params.data, params.context)) return;

    const pending = this.hub.pending.get<string, any>(bucket, params.data.requestId);
    if (!pending) {
      if (!this.hub.isOpen) {
        params.warnMissingPendingWhenClosed?.(params.data);
      }
      return;
    }

    if (!params.context.handledBy) {
      params.context.handledBy = params.handledBy;
    }

    this.hub.pending.clearTimeout(pending.timeoutId);
    this.hub.pending.delete(bucket, params.data.requestId);
    pending.resolve(true, (params.data as any).ack);
  }

  /**
   * Handle ACK for isConnect ping waiter.
   */
  private handleIsConnectAck(
    data: PostMessageData,
    context: MessageContext,
    params: { handledBy: string; isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean }
  ): boolean {
    const pending = this.hub.pending.get<string, any>(RequestIframeEndpointFacade.PENDING_IS_CONNECT, data.requestId);
    if (!pending) return false;

    /** Optional extra origin guard (coarse filter) */
    if (params.isOriginAllowed && !params.isOriginAllowed(data, context)) {
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = params.handledBy;
      }
      return true; // handled but ignored
    }

    /** Must match the pending target origin (and originValidator if configured) */
    if (!this.hub.isOriginAllowedBy(context.origin, data, context, pending.targetOrigin, this.originValidator)) {
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = params.handledBy;
      }
      return true; // handled but ignored
    }
    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = params.handledBy;
    }
    this.hub.pending.clearTimeout(pending.timeoutId);
    this.hub.pending.delete(RequestIframeEndpointFacade.PENDING_IS_CONNECT, data.requestId);
    pending.onPeerId?.(data.creatorId);
    pending.resolve(true);
    return true;
  }

  /**
   * Handle PONG for isConnect ping waiter.
   */
  private handleIsConnectPong(
    data: PostMessageData,
    context: MessageContext,
    params: { handledBy: string; isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean }
  ): boolean {
    const pending = this.hub.pending.get<string, any>(RequestIframeEndpointFacade.PENDING_IS_CONNECT, data.requestId);
    if (!pending) return false;

    /** Optional extra origin guard (coarse filter) */
    if (params.isOriginAllowed && !params.isOriginAllowed(data, context)) {
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = params.handledBy;
      }
      return true; // handled but ignored
    }

    /** Must match the pending target origin (and originValidator if configured) */
    if (!this.hub.isOriginAllowedBy(context.origin, data, context, pending.targetOrigin, this.originValidator)) {
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = params.handledBy;
      }
      return true; // handled but ignored
    }
    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = params.handledBy;
    }
    this.hub.pending.clearTimeout(pending.timeoutId);
    this.hub.pending.delete(RequestIframeEndpointFacade.PENDING_IS_CONNECT, data.requestId);
    pending.onPeerId?.(data.creatorId);
    pending.resolve(true);
    return true;
  }

  /**
   * Dispatch incoming stream_* messages (stream_data/stream_end/...) to bound handler.
   */
  public dispatchStreamMessage(
    data: PostMessageData,
    context: MessageContext,
    params?: { isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean }
  ): void {
    if (params?.isOriginAllowed && !params.isOriginAllowed(data, context)) return;
    this.streamRouter.dispatch(data, context);
  }

  /**
   * Pending stream_start waiter entry.
   *
   * Server stores this entry when it receives a REQUEST that declares a streamId.
   * When stream_start arrives, facade creates a ReadableStream and calls `continue`.
   */
  public handleStreamStart(params: {
    data: PostMessageData;
    context: MessageContext;
    expectedRole?: MessageRoleValue;
    pendingBucket: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
  }): void {
    const { data, context } = params;
    if (params.expectedRole && data.role !== params.expectedRole) return;
    if (params.isOriginAllowed && !params.isOriginAllowed(data, context)) return;

    const body: any = data.body;
    if (!body?.streamId) return;

    const pending = this.hub.pending.get<string, any>(params.pendingBucket, data.requestId);
    if (!pending) {
      if (!this.hub.isOpen) {
        params.warnMissingPendingWhenClosed?.(data);
      }
      return;
    }
    if (pending.streamId !== body.streamId) return;

    this.hub.pending.clearTimeout(pending.timeoutId);
    this.hub.pending.delete(params.pendingBucket, data.requestId);

    const streamHandler: StreamMessageHandler = createStreamMessageHandler({
      router: this.streamRouter,
      postMessage: (message) => {
        this.hub.messageDispatcher.send(pending.targetWindow, message, pending.targetOrigin);
      }
    });

    const created = createReadableStreamFromStart({
      requestId: data.requestId,
      data,
      handler: streamHandler,
      secretKey: data.secretKey
    });
    if (!created) return;

    pending.continue({
      stream: created.stream as IframeReadableStream<any> | IframeFileReadableStream,
      info: created.info as StreamStartInfo,
      data,
      context
    });
  }

  private static buildOriginValidator(input?: {
    allowedOrigins?: OriginMatcher;
    validateOrigin?: OriginValidator;
  }): ((origin: string, data: PostMessageData, context: MessageContext) => boolean) | undefined {
    if (!input) return undefined;
    if (input.validateOrigin) {
      return (origin, data, context) => input.validateOrigin!(origin, data, context);
    }
    if (input.allowedOrigins) {
      const matcher = input.allowedOrigins;
      return (origin) => matchOrigin(origin, matcher);
    }
    return undefined;
  }
}

