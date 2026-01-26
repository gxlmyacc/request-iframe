import { PostMessageData } from '../types';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../utils/cache';
import { isCompatibleVersion } from '../utils';
import { MessageType, DefaultTimeout, ProtocolVersion, Messages, formatMessage } from '../constants';

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
  
  /** Stream message callback */
  private streamCallback?: StreamMessageCallback;
  
  /** List of unregister handler functions */
  private readonly unregisterFns: Array<() => void> = [];
  
  /** Whether opened */
  private _isOpen = false;

  public constructor(options?: ClientServerOptions) {
    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.SERVER_ACK;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel);
    
    // Auto-open by default
    this.open();
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

    // Handle ACK messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ACK,
        (data, context) => this.handleClientResponse(data, context),
        handlerOptions
      )
    );

    // Handle ASYNC messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ASYNC,
        (data, context) => this.handleClientResponse(data, context),
        handlerOptions
      )
    );

    // Handle RESPONSE messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RESPONSE,
        (data, context) => this.handleClientResponse(data, context),
        handlerOptions
      )
    );

    // Handle ERROR messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.ERROR,
        (data, context) => this.handleClientResponse(data, context),
        handlerOptions
      )
    );

    // Handle RECEIVED messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RECEIVED,
        (data) => this.handleReceived(data),
        handlerOptions
      )
    );

    // Handle PONG messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.PONG,
        (data, context) => this.handlePong(data, context),
        handlerOptions
      )
    );

    // Handle stream messages (stream_*)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        (type: string) => type.startsWith('stream_'),
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
    if (pending) {
      // Validate origin
      if (pending.origin && pending.origin !== '*' && context.origin !== pending.origin) {
        return;
      }
      // ack and async don't delete pending
      if (data.type === MessageType.ACK || data.type === MessageType.ASYNC) {
        pending.resolve(data);
        return;
      }
      // response and error delete pending
      this.pendingRequests.delete(data.requestId);
      pending.resolve(data);
    }
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
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
