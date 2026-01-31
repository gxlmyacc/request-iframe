import {
  StreamState,
  StreamBindContext,
  WritableStreamOptions,
  IIframeWritableStream,
  StreamChunk,
  WritableStreamMode
} from './types';
import { createPostMessage } from '../utils';
import { MessageType, Messages, StreamType as StreamTypeConstant, StreamState as StreamStateConstant, StreamMode as StreamModeConstant, MessageRole, formatMessage, DefaultTimeout, StreamInternalMessageType, StreamEvent } from '../constants';
import type { StreamMessageData } from './types';
import { IframeStreamCore } from './stream-core';

/**
 * Generate a unique stream ID
 */
function generateStreamId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * IframeWritableStream - Server-side writable stream
 * Used to send stream data to the client
 */
export class IframeWritableStream
  extends IframeStreamCore<any>
  implements IIframeWritableStream {
  public readonly mode: WritableStreamMode;
  
  private context: StreamBindContext | null = null;
  private readonly iterator?: () => AsyncGenerator<any, void, unknown>;
  private readonly nextFn?: () => Promise<StreamChunk> | StreamChunk;
  private readonly autoResolve?: boolean;
  private readonly expireTimeout?: number;
  private readonly streamTimeout?: number;
  private expireTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRemoteActivityAt = Date.now();
  private heartbeatInFlight: Promise<boolean> | null = null;

  /** pull/ack protocol */
  private pullCredit = 0;
  private seq = 0;
  private readonly pendingQueue: Array<{ data: any; done: boolean }> = [];
  private pumping = false;
  private completionPromise: Promise<void> | null = null;
  private resolveCompletion: (() => void) | null = null;
  private rejectCompletion: ((err: Error) => void) | null = null;

  public constructor(options: WritableStreamOptions = {}) {
    const streamId = generateStreamId();
    const streamType = options.type ?? StreamTypeConstant.DATA;
    const chunked = options.chunked ?? true;
    super(streamId, streamType, chunked, options.metadata, false, options.mode);

    this.mode = options.mode ?? StreamModeConstant.PULL;
    this.iterator = options.iterator;
    this.nextFn = options.next;
    this.autoResolve = options.autoResolve;
    // Default to async-timeout length to avoid leaking long-lived streams
    this.expireTimeout = options.expireTimeout ?? DefaultTimeout.ASYNC;
    this.streamTimeout = options.streamTimeout;
  }

  /** Get stream state */
  public override get state(): StreamState {
    return super.state;
  }

  /**
   * Bind to request context
   * Called during res.sendStream()
   */
  public _bind(context: StreamBindContext): void {
    this.context = context;
  }

  private registerControlHandler(): void {
    if (!this.context?.registerStreamHandler) return;
    this.context.registerStreamHandler(this.streamId, this.handleControlMessage.bind(this));
  }

  private unregisterControlHandler(): void {
    if (!this.context?.unregisterStreamHandler) return;
    this.context.unregisterStreamHandler(this.streamId);
  }

  private handleControlMessage(data: StreamMessageData): void {
    // Update remote activity timestamp on any control message
    this.lastRemoteActivityAt = Date.now();

    switch (data.type as string) {
      case StreamInternalMessageType.PULL: {
        const credit = typeof data.credit === 'number' && data.credit > 0 ? data.credit : 1;
        this.pullCredit += credit;
        this.emit(StreamEvent.PULL, { credit, totalCredit: this.pullCredit });
        // Try flushing buffered chunks or pumping generator
        this.flush();
        break;
      }
      case StreamInternalMessageType.ACK:
        // Ack is treated as heartbeat; no further action required
        this.emit(StreamEvent.ACK, { seq: data.seq });
        break;
      case StreamInternalMessageType.CANCEL:
        this.emit(StreamEvent.CANCEL, { reason: data.reason, remote: true });
        this.cancel(data.reason);
        break;
      default:
        break;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async performHeartbeat(): Promise<boolean> {
    if (!this.context?.heartbeat) return false;
    if (!this.heartbeatInFlight) {
      this.heartbeatInFlight = Promise.resolve()
        .then(() => this.context!.heartbeat!())
        .catch(() => false)
        .finally(() => {
          this.heartbeatInFlight = null;
        });
    }
    return this.heartbeatInFlight;
  }

  private startIdleTimer(): void {
    if (!this.streamTimeout || this.streamTimeout <= 0) return;
    this.clearIdleTimer();
    const timeout = this.streamTimeout;
    this.idleTimer = setTimeout(async () => {
      if (this._state !== StreamStateConstant.STREAMING) return;
      // If we had recent remote activity, postpone
      if (Date.now() - this.lastRemoteActivityAt < timeout) {
        this.startIdleTimer();
        return;
      }
      const ok = await this.performHeartbeat();
      if (ok) {
        this.lastRemoteActivityAt = Date.now();
        this.startIdleTimer();
        return;
      }
      try {
        this.emit(StreamEvent.TIMEOUT, { timeout });
        this.error(formatMessage(Messages.STREAM_TIMEOUT, timeout));
      } catch {
        /** ignore */
      }
    }, timeout);
  }

  /**
   * Send message (to client when server-side stream, to server when client-side stream)
   */
  private sendMessage(type: string, data?: Record<string, any>): boolean {
    if (!this.context) {
      throw new Error(Messages.STREAM_NOT_BOUND);
    }
    const isClientStream = this.context.clientId !== undefined && this.context.serverId === undefined;
    const role = isClientStream ? MessageRole.CLIENT : MessageRole.SERVER;
    const creatorId = this.context.serverId ?? this.context.clientId;
    const message = createPostMessage(type as any, this.context.requestId, {
      secretKey: this.context.secretKey,
      body: {
        streamId: this.streamId,
        ...data
      },
      role,
      creatorId,
      targetId: this.context.targetId
    });
    
    const ok = this.context.channel.send(this.context.targetWindow, message, this.context.targetOrigin);
    if (!ok) {
      this._state = StreamStateConstant.CANCELLED;
      this.clearExpireTimer();
      // For most stream messages, if we cannot send, treat as a hard cancellation signal
      // so callers can stop further processing immediately.
      throw new Error(formatMessage(Messages.STREAM_CANCELLED, 'Target window closed'));
    }
    return true;
  }

  private clearExpireTimer(): void {
    if (this.expireTimer) {
      clearTimeout(this.expireTimer);
      this.expireTimer = null;
    }
  }

  private startExpireTimer(): void {
    if (!this.expireTimeout || this.expireTimeout <= 0) return;
    const expireTimeout = this.expireTimeout;
    this.clearExpireTimer();
    this.expireTimer = setTimeout(() => {
      if (this._state !== StreamStateConstant.STREAMING) return;
      try {
        this.emit(StreamEvent.EXPIRED, { timeout: expireTimeout });
        this.error(formatMessage(Messages.STREAM_EXPIRED, expireTimeout));
      } catch {
        /** ignore timer-triggered send failures */
      }
    }, expireTimeout);
  }

  /**
   * Start stream transfer
   */
  public async start(): Promise<void> {
    if (!this.context) {
      throw new Error(Messages.STREAM_NOT_BOUND);
    }
    
    if (this._state !== StreamStateConstant.PENDING) {
      throw new Error(Messages.STREAM_ALREADY_STARTED);
    }

    this.completionPromise = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });

    this._state = StreamStateConstant.STREAMING;
    this.startExpireTimer();
    this.startIdleTimer();
    this.lastRemoteActivityAt = Date.now();
    this.registerControlHandler();

    // Send stream start message
    this.sendMessage(MessageType.STREAM_START, {
      type: this.type,
      mode: this.mode,
      chunked: this.chunked,
      metadata: this.metadata,
      autoResolve: this.autoResolve
    });
    this.emit(StreamEvent.START, {
      streamId: this.streamId,
      type: this.type,
      chunked: this.chunked,
      mode: this.mode,
      metadata: this.metadata
    });

    try {
      if (this.mode === StreamModeConstant.PUSH) {
        // Push mode: user will call write()/end() manually.
        return await this.completionPromise;
      }
      // pull protocol: produce only when receiver grants credit
      this.flush();
      return await this.completionPromise;
    } catch (error: any) {
      // If stream was cancelled due to target window closed, propagate to caller
      if ((this._state as StreamState) === StreamStateConstant.CANCELLED) {
        this.clearExpireTimer();
        throw error;
      }
      this.error(error.message || String(error));
      return await this.completionPromise;
    }
  }

  /**
   * Push a chunk manually (mode === 'push').
   */
  public write(data: any, done: boolean = false): void {
    if (this.mode !== StreamModeConstant.PUSH) {
      throw new Error(Messages.STREAM_WRITE_ONLY_IN_PUSH_MODE);
    }
    if (this._state === StreamStateConstant.PENDING) {
      /**
       * In push mode, users must call start() first so STREAM_START is sent and binding is complete.
       */
      throw new Error(Messages.STREAM_NOT_BOUND);
    }
    if (this._state !== StreamStateConstant.STREAMING) {
      throw new Error(Messages.STREAM_ENDED);
    }
    // push mode now buffers and sends based on pull credit
    this.pendingQueue.push({ data, done });
    this.emit(StreamEvent.WRITE, { data, done });
    this.flush();
  }

  /**
   * End the stream (mode === 'push').
   */
  public end(): void {
    if (this.mode !== StreamModeConstant.PUSH) {
      // For pull mode, end is controlled internally
      this.endInternal();
      return;
    }
    // In push mode, end means enqueue a terminal marker if nothing queued
    if (this.mode === StreamModeConstant.PUSH) {
      if (this.pendingQueue.length === 0) {
        this.pendingQueue.push({ data: undefined, done: true });
      } else {
        // Ensure the last queued chunk marks done
        this.pendingQueue[this.pendingQueue.length - 1].done = true;
      }
      this.flush();
      return;
    }
    this.endInternal();
  }

  /**
   * Generate data from iterator
   */
  private async pumpFromGenerator(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      if (this.iterator) {
        const gen = this.iterator();
        while (this._state === StreamStateConstant.STREAMING) {
          if (this.pullCredit <= 0) break;
          const r = await gen.next();
          if (r.done) {
            // no more data: send end
            this.endInternal();
            break;
          }
          this.pendingQueue.push({ data: r.value, done: false });
          this.flush();
        }
      } else if (this.nextFn) {
        while (this._state === StreamStateConstant.STREAMING) {
          if (this.pullCredit <= 0) break;
          const result = await Promise.resolve(this.nextFn());
          this.pendingQueue.push({ data: result.data, done: result.done });
          this.flush();
          if (result.done) break;
        }
      } else {
        // No producer, just end when pulled
        if (this.pullCredit > 0) {
          this.endInternal();
        }
      }
    } catch (e: any) {
      if (this._state === StreamStateConstant.STREAMING) {
        this.error(e?.message || String(e));
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Send data chunk
   */
  private sendData(data: any, done: boolean = false): void {
    const seq = this.seq++;
    this.sendMessage(MessageType.STREAM_DATA, {
      data: this.encodeData(data),
      done,
      seq
    });
    this.emit(StreamEvent.SEND, { seq, done });
  }

  private flush(): void {
    if (this._state !== StreamStateConstant.STREAMING) return;

    // First try to pump from generator if needed
    if (this.mode === StreamModeConstant.PULL && this.pendingQueue.length === 0) {
      void this.pumpFromGenerator();
    }

    while (this.pullCredit > 0 && this.pendingQueue.length > 0 && this._state === StreamStateConstant.STREAMING) {
      const item = this.pendingQueue.shift()!;
      this.pullCredit--;
      try {
        this.sendData(item.data, item.done);
      } catch (e: any) {
        // send failure treated as cancellation
        this._state = StreamStateConstant.CANCELLED;
        this.clearExpireTimer();
        this.clearIdleTimer();
        this.unregisterControlHandler();
        this.rejectCompletion?.(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
      if (item.done) {
        this.endInternal();
        break;
      }
    }
  }

  /**
   * Encode data (subclasses can override, e.g., FileStream needs Base64 encoding)
   */
  protected encodeData(data: any): any {
    return data;
  }

  /**
   * End stream
   */
  private endInternal(): void {
    if (this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.ENDED;
    this.clearExpireTimer();
    this.clearIdleTimer();
    this.unregisterControlHandler();
    this.sendMessage(MessageType.STREAM_END);
    this.emit(StreamEvent.END);
    this.emit(StreamEvent.STATE, { state: this._state });
    this.clearAllListeners();
    this.resolveCompletion?.();
  }

  /**
   * Send error
   */
  private error(message: string): void {
    if (this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.ERROR;
    this.clearExpireTimer();
    this.clearIdleTimer();
    this.unregisterControlHandler();
    this.sendMessage(MessageType.STREAM_ERROR, {
      error: message
    });
    this.emit(StreamEvent.ERROR, { error: new Error(message) });
    this.emit(StreamEvent.STATE, { state: this._state });
    this.clearAllListeners();
    this.resolveCompletion?.();
  }

  /**
   * Abort stream transfer (is alias of cancel method)
   */
  public abort(reason?: string): void {
    this.cancel(reason);
  }

  /**
   * Cancel stream transfer
   */
  public cancel(reason?: string): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.CANCELLED;
    this.clearExpireTimer();
    this.clearIdleTimer();
    this.unregisterControlHandler();
    this.emit(StreamEvent.CANCEL, { reason, remote: false });
    this.emit(StreamEvent.STATE, { state: this._state });
    
    if (this.context) {
      try {
        this.sendMessage(MessageType.STREAM_CANCEL, {
          reason
        });
      } catch {
        // ignore send failures on cancel
      }
    }
    this.clearAllListeners();
    this.resolveCompletion?.();
  }
}
