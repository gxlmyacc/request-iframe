import type { PostMessageData } from '../types';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../utils/cache';
import { isCompatibleVersion } from '../utils';
import { MessageType, ProtocolVersion, Messages, formatMessage, MessageRole, OriginConstant } from '../constants';

/**
 * Stream message handler callback
 */
export type StreamMessageCallback = (data: PostMessageData, context: MessageContext) => void;

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
 * ClientServer configuration options
 */
export interface ClientServerOptions {
  /** Message isolation key */
  secretKey?: string;
  /** Protocol version validator (optional, uses built-in validation by default) */
  versionValidator?: VersionValidator;
  /** Whether to automatically open when creating the client server. Default is true. */
  autoOpen?: boolean;
  /** Advanced: auto-ack echo limit for ack.meta length (internal). */
  autoAckMaxMetaLength?: number;
  /** Advanced: auto-ack echo limit for ack.id length (internal). */
  autoAckMaxIdLength?: number;
}

/**
 * RequestIframeClientServer - Client-side message server
 * Only handles responses, not requests
 * Uses shared MessageDispatcher (backed by MessageChannel) to listen for and send messages
 */
export class RequestIframeClientServer {
  private readonly dispatcher: MessageDispatcher;
  private readonly versionValidator: VersionValidator;
  
  /** Pending requests awaiting response */
  private readonly pendingRequests = new Map<string, PendingRequest>();

  /**
   * Avoid spamming logs for the same requestId when closed/destroyed
   */
  private readonly warnedMissingPendingWhenClosed = new Set<string>();
  
  /** Stream message callback */
  private streamCallback?: StreamMessageCallback;
  
  /** List of unregister handler functions */
  private readonly unregisterFns: Array<() => void> = [];
  
  /** Whether opened */
  private _isOpen = false;

  public constructor(options?: ClientServerOptions, instanceId?: string) {
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel, MessageRole.CLIENT, instanceId);
    this.dispatcher.setAutoAckLimits({
      maxMetaLength: options?.autoAckMaxMetaLength,
      maxIdLength: options?.autoAckMaxIdLength
    });
    
    // Auto-open by default (unless explicitly set to false)
    if (options?.autoOpen !== false) {
      this.open();
    }
  }

  /**
   * Open message handling (register message handlers)
   */
  public open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.registerHandlers();
  }

  /**
   * Close message handling (unregister message handlers, but don't release channel)
   */
  public close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    
    // Unregister all handlers
    this.unregisterFns.forEach(fn => fn());
    this.unregisterFns.length = 0;
  }

  /**
   * Whether opened
   */
  public get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Register message handlers
   */
  private registerHandlers(): void {
    const handlerOptions = {
      versionValidator: this.versionValidator,
      onVersionError: this.handleVersionError.bind(this)
    };

    // Bind handleClientResponse to ensure correct 'this' context
    const boundHandleClientResponse = this.handleClientResponse.bind(this);

    // Handle ACK messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ACK,
        boundHandleClientResponse,
        handlerOptions
      )
    );

    // Handle ASYNC messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ASYNC,
        boundHandleClientResponse,
        handlerOptions
      )
    );

    // Handle RESPONSE messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RESPONSE,
        boundHandleClientResponse,
        handlerOptions
      )
    );

    // Handle ERROR messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ERROR,
        boundHandleClientResponse,
        handlerOptions
      )
    );

    // Handle PONG messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.PONG,
        this.handlePong.bind(this),
        handlerOptions
      )
    );

    // Handle PING messages (server -> client heartbeat)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.PING,
        this.handlePing.bind(this),
        handlerOptions
      )
    );

    // Handle stream_start messages (route to handleClientResponse so it reaches send callback)
    // Note: stream_start is handled in send callback, not through streamCallback
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.STREAM_START,
        boundHandleClientResponse,
        handlerOptions
      )
    );

    // Handle other stream messages (stream_data, stream_end, etc.)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        (type: string) => type.startsWith('stream_') && type !== MessageType.STREAM_START,
        (data, context) => this.streamCallback?.(data, context),
        handlerOptions
      )
    );
  }

  private handlePing(data: PostMessageData, context: MessageContext): void {
    if (!context.source) return;
    // Mark accepted so MessageDispatcher can auto-send ACK when requireAck === true
    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = 'client';
    }
    // Reply PONG
    this.dispatcher.sendMessage(context.source, context.origin, MessageType.PONG, data.requestId, {
      targetId: data.creatorId
    });
  }

  /**
   * Handle protocol version error
   */
  private handleVersionError(data: PostMessageData, context: MessageContext, version: number): void {
    // For response messages, we need to notify the waiting request
    const pending = this.pendingRequests.get(data.requestId);
    if (pending) {
      this.pendingRequests.delete(data.requestId);
      pending.reject(new Error(
        formatMessage(Messages.PROTOCOL_VERSION_TOO_LOW, version, ProtocolVersion.MIN_SUPPORTED)
      ));
    }
  }

  /**
   * Handle client response
   */
  private handleClientResponse(data: PostMessageData, context: MessageContext): void {
    const pending = this.pendingRequests.get(data.requestId);
    if (!pending) {
      /**
       * Pending request not found - ignore by default.
       *
       * If client server is already closed/destroyed, emit a warning to help debugging:
       * this usually means the client was recreated/unmounted before the response arrived.
       */
      if (!this._isOpen) {
        const key = data.requestId;
        if (!this.warnedMissingPendingWhenClosed.has(key)) {
          this.warnedMissingPendingWhenClosed.add(key);
          // eslint-disable-next-line no-console
          console.warn(formatMessage(Messages.CLIENT_SERVER_IGNORED_MESSAGE_WHEN_CLOSED, data.type, data.requestId));
        }
      }
      return;
    }
    
    // Validate origin
    if (pending.originValidator) {
      try {
        if (!pending.originValidator(context.origin, data, context)) {
          return;
        }
      } catch {
        // If validator throws, treat as disallowed
        return;
      }
    } else if (pending.origin && pending.origin !== OriginConstant.ANY && context.origin !== pending.origin) {
      return;
    }

    /**
     * Mark as handled so:
     * - other client instances sharing the same channel won't also process it
     * - MessageDispatcher can run its generalized requireAck auto-ack logic
     */
    if (!context.handledBy) {
      context.accepted = true;
      context.handledBy = 'client';
    }
    
    // ack, async, and stream_start don't delete pending (stream_start needs to keep pending for stream_data/stream_end)
    if (data.type === MessageType.ACK || data.type === MessageType.ASYNC || data.type === MessageType.STREAM_START) {
      pending.resolve(data);
      return;
    }
    
    // response and error delete pending
    this.pendingRequests.delete(data.requestId);
    pending.resolve(data);
  }

  /**
   * Handle pong
   */
  private handlePong(data: PostMessageData, context: MessageContext): void {
    const pending = this.pendingRequests.get(data.requestId);
    if (pending) {
      if (pending.originValidator) {
        try {
          if (!pending.originValidator(context.origin, data, context)) {
            return;
          }
        } catch {
          return;
        }
      } else if (pending.origin && pending.origin !== OriginConstant.ANY && context.origin !== pending.origin) {
        return;
      }
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = 'client';
      }
      this.pendingRequests.delete(data.requestId);
      pending.resolve(data);
    }
  }

  /**
   * Set stream message handler callback
   */
  public setStreamCallback(callback: StreamMessageCallback): void {
    this.streamCallback = callback;
  }

  /** Get secretKey */
  public get secretKey(): string | undefined {
    return this.dispatcher.secretKey;
  }

  /** Get the underlying MessageDispatcher */
  public get messageDispatcher(): MessageDispatcher {
    return this.dispatcher;
  }

  /**
   * Register pending request awaiting response
   */
  public _registerPendingRequest(
    requestId: string,
    resolve: (data: PostMessageData) => void,
    reject: (error: Error) => void,
    origin?: string,
    originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean
  ): void {
    this.pendingRequests.set(requestId, { resolve, reject, origin, originValidator });
  }

  /**
   * Cancel pending response
   */
  public _unregisterPendingRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
  }

  /**
   * Send ping message
   */
  public sendPing(targetWindow: Window, targetOrigin: string, requestId: string): void {
    this.dispatcher.sendMessage(targetWindow, targetOrigin, MessageType.PING, requestId);
  }

  /**
   * Destroy (close and release channel reference)
   */
  public destroy(): void {
    // Close first
    this.close();
    
    // Clear pending
    this.pendingRequests.clear();
    this.warnedMissingPendingWhenClosed.clear();
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
