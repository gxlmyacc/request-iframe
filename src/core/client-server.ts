import { PostMessageData } from '../types';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../utils/cache';
import { isCompatibleVersion } from '../utils';
import { MessageType, DefaultTimeout, ProtocolVersion, Messages, formatMessage, MessageRole } from '../constants';

/**
 * Stream message handler callback
 */
export type StreamMessageCallback = (data: PostMessageData, context: MessageContext) => void;

/**
 * Pending acknowledgment response
 */
interface PendingAck {
  resolve: (received: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Pending request awaiting response
 */
interface PendingRequest {
  resolve: (data: PostMessageData) => void;
  reject: (error: Error) => void;
  origin?: string;
}

/**
 * ClientServer configuration options
 */
export interface ClientServerOptions {
  /** Message isolation key */
  secretKey?: string;
  /** ACK timeout */
  ackTimeout?: number;
  /** Protocol version validator (optional, uses built-in validation by default) */
  versionValidator?: VersionValidator;
  /** Whether to automatically open when creating the client server. Default is true. */
  autoOpen?: boolean;
}

/**
 * RequestIframeClientServer - Client-side message server
 * Only handles responses, not requests
 * Uses shared MessageDispatcher (backed by MessageChannel) to listen for and send messages
 */
export class RequestIframeClientServer {
  private readonly dispatcher: MessageDispatcher;
  private readonly ackTimeout: number;
  private readonly versionValidator: VersionValidator;
  
  /** Pending responses awaiting client acknowledgment */
  private readonly pendingAcks = new Map<string, PendingAck>();
  
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
    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel, MessageRole.CLIENT, instanceId);
    
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

    // Handle RECEIVED messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RECEIVED,
        this.handleReceived.bind(this),
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
    if (pending.origin && pending.origin !== '*' && context.origin !== pending.origin) {
      return;
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
   * Handle received acknowledgment
   */
  private handleReceived(data: PostMessageData): void {
    const pending = this.pendingAcks.get(data.requestId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingAcks.delete(data.requestId);
      pending.resolve(true);
    }
  }

  /**
   * Handle pong
   */
  private handlePong(data: PostMessageData, context: MessageContext): void {
    const pending = this.pendingRequests.get(data.requestId);
    if (pending) {
      if (pending.origin && pending.origin !== '*' && context.origin !== pending.origin) {
        return;
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
   * Register pending acknowledgment response
   */
  public _registerPendingAck(
    requestId: string,
    resolve: (received: boolean) => void,
    reject: (error: Error) => void
  ): void {
    const timeoutId = setTimeout(() => {
      this.pendingAcks.delete(requestId);
      resolve(false);
    }, this.ackTimeout);

    this.pendingAcks.set(requestId, { resolve, reject, timeoutId });
  }

  /**
   * Register pending request awaiting response
   */
  public _registerPendingRequest(
    requestId: string,
    resolve: (data: PostMessageData) => void,
    reject: (error: Error) => void,
    origin?: string
  ): void {
    this.pendingRequests.set(requestId, { resolve, reject, origin });
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
    this.pendingAcks.forEach((pending) => clearTimeout(pending.timeoutId));
    this.pendingAcks.clear();
    this.warnedMissingPendingWhenClosed.clear();
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
