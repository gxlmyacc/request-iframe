import type { PostMessageData } from '../../types';
import type { VersionValidator } from '../../message';
import { MessageContext } from '../../message';
import { MessageType, ProtocolVersion, Messages, formatMessage, MessageRole, WarnOnceKey, buildWarnOnceKey } from '../../constants';
import type { RequestIframeEndpointHub } from './hub';
import { createPingResponder } from '../heartbeat/ping';
import { SyncHook } from '../../utils/hooks';
import { requestIframeLog } from '../../utils/logger';

/**
 * Pending request awaiting response
 */
interface PendingRequest {
  resolve: (data: PostMessageData) => void;
  reject: (error: Error) => void;
  origin?: string;
  originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean;
}

/**
 * RequestIframeEndpointInbox
 *
 * The endpoint "inbox" is responsible for handling inbound framework messages and
 * driving pending request resolution by requestId.
 *
 * - Registers dispatcher handlers for ACK/ASYNC/RESPONSE/ERROR/STREAM_START + PING/PONG
 * - Manages pending requests via hub.pending
 */
export class RequestIframeEndpointInbox {
  public static readonly PENDING_REQUESTS = 'inbox:pendingRequests';

  public readonly hooks = {
    inbound: new SyncHook<[data: PostMessageData, context: MessageContext]>(),
    pendingRegistered: new SyncHook<[requestId: string, info: { origin?: string }]>(),
    pendingUnregistered: new SyncHook<[requestId: string]>(),
    pendingResolved: new SyncHook<[requestId: string, data: PostMessageData]>(),
    missingPending: new SyncHook<[data: PostMessageData, context: MessageContext]>()
  };

  private readonly hub: RequestIframeEndpointHub;
  private readonly versionValidator: VersionValidator;

  public constructor(hub: RequestIframeEndpointHub, versionValidator?: VersionValidator) {
    this.hub = hub;
    this.versionValidator = versionValidator ?? hub.versionValidator;
  }

  /**
   * Register message handlers on hub.
   */
  public registerHandlers(): void {
    const handlerOptions = this.hub.createHandlerOptions(this.handleVersionError.bind(this));
    handlerOptions.versionValidator = this.versionValidator;

    const boundHandleClientResponse = this.handleClientResponse.bind(this);

    this.hub.registerHandler(MessageType.ACK, boundHandleClientResponse, handlerOptions);
    this.hub.registerHandler(MessageType.ASYNC, boundHandleClientResponse, handlerOptions);
    this.hub.registerHandler(MessageType.RESPONSE, boundHandleClientResponse, handlerOptions);
    this.hub.registerHandler(MessageType.ERROR, boundHandleClientResponse, handlerOptions);
    this.hub.registerHandler(MessageType.PONG, this.handlePong.bind(this), handlerOptions);
    this.hub.registerHandler(MessageType.PING, this.handlePing.bind(this), handlerOptions);
    this.hub.registerHandler(MessageType.STREAM_START, boundHandleClientResponse, handlerOptions);
  }

  /**
   * Register pending request awaiting response
   */
  public registerPendingRequest(
    requestId: string,
    resolve: (data: PostMessageData) => void,
    reject: (error: Error) => void,
    origin?: string,
    originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean
  ): void {
    this.hub.pending.set(RequestIframeEndpointInbox.PENDING_REQUESTS, requestId, { resolve, reject, origin, originValidator });
    this.hooks.pendingRegistered.call(requestId, { origin });
  }

  /**
   * Cancel pending response
   */
  public unregisterPendingRequest(requestId: string): void {
    this.hub.pending.delete(RequestIframeEndpointInbox.PENDING_REQUESTS, requestId);
    this.hooks.pendingUnregistered.call(requestId);
  }

  private handlePing(data: PostMessageData, context: MessageContext): void {
    this.hooks.inbound.call(data, context);
    const responder = createPingResponder({
      hub: this.hub,
      handledBy: this.hub.instanceId ?? MessageRole.CLIENT,
      includeTargetId: true
    });
    responder(data, context);
  }

  /**
   * Handle protocol version error
   */
  private handleVersionError(data: PostMessageData, context: MessageContext, version: number): void {
    void context;
    const pending = this.hub.pending.get<string, PendingRequest>(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
    if (pending) {
      this.hub.pending.delete(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
      pending.reject(new Error(
        formatMessage(Messages.PROTOCOL_VERSION_TOO_LOW, version, ProtocolVersion.MIN_SUPPORTED)
      ));
    }
  }

  /**
   * Handle client response
   */
  private handleClientResponse(data: PostMessageData, context: MessageContext): void {
    this.hooks.inbound.call(data, context);
    const pending = this.hub.pending.get<string, PendingRequest>(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
    if (!pending) {
      /**
       * Pending request not found - ignore by default.
       *
       * If endpoint is already closed/destroyed, emit a warning to help debugging:
       * this usually means the client was recreated/unmounted before the response arrived.
       */
      if (!this.hub.isOpen) {
        this.hooks.missingPending.call(data, context);
        this.hub.warnOnce(buildWarnOnceKey(WarnOnceKey.INBOX_MISSING_PENDING_WHEN_CLOSED, data.requestId), () => {
          requestIframeLog('warn', formatMessage(Messages.CLIENT_SERVER_IGNORED_MESSAGE_WHEN_CLOSED, data.type, data.requestId));
        });
      }
      return;
    }

    /** Validate origin */
    if (!this.hub.isOriginAllowedBy(context.origin, data, context, pending.origin, pending.originValidator)) {
      return;
    }

    /**
     * Mark as handled so:
     * - other client instances sharing the same channel won't also process it
     * - MessageDispatcher can run its generalized requireAck auto-ack logic
     */
    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = this.hub.instanceId ?? MessageRole.CLIENT;
    }

    /** ack, async, and stream_start don't delete pending (stream_start needs to keep pending for stream_data/stream_end) */
    if (data.type === MessageType.ACK || data.type === MessageType.ASYNC || data.type === MessageType.STREAM_START) {
      this.hooks.pendingResolved.call(data.requestId, data);
      pending.resolve(data);
      return;
    }

    /** response and error delete pending */
    this.hub.pending.delete(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
    this.hooks.pendingResolved.call(data.requestId, data);
    pending.resolve(data);
  }

  /**
   * Handle PONG:
   * - If it matches an existing pending request, resolve it.
   * - Otherwise, ignore (facade may still use PONG for isConnect waiter).
   */
  private handlePong(data: PostMessageData, context: MessageContext): void {
    this.hooks.inbound.call(data, context);
    const pending = this.hub.pending.get<string, PendingRequest>(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
    if (!pending) return;

    if (!this.hub.isOriginAllowedBy(context.origin, data, context, pending.origin, pending.originValidator)) {
      return;
    }

    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = this.hub.instanceId ?? MessageRole.CLIENT;
    }

    this.hub.pending.delete(RequestIframeEndpointInbox.PENDING_REQUESTS, data.requestId);
    this.hooks.pendingResolved.call(data.requestId, data);
    pending.resolve(data);
  }
}

