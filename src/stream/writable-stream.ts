import {
  StreamState,
  StreamBindContext,
  WritableStreamOptions,
  IIframeWritableStream,
  StreamChunk,
  WritableStreamMode,
  StreamFrameOptions
} from './types';
import { createPostMessage } from '../utils/protocol';
import { generateRequestId } from '../utils/id';
import { isFunction } from '../utils/is';
import { MessageType, Messages, StreamType as StreamTypeConstant, StreamState as StreamStateConstant, StreamMode as StreamModeConstant, MessageRole, formatMessage, DefaultTimeout, StreamInternalMessageType, StreamEvent, ErrorCode } from '../constants';
import type { StreamMessageData } from './types';
import { IframeStreamCore } from './stream-core';
import { RequestIframeStreamError } from './error';

/**
 * Generate a unique stream ID
 */
function generateStreamId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * IframeWritableStream - Server-side writable stream
 *
 * Writer/producer stream.
 * It can be created on either side:
 * - Server → Client: used as response stream (via `res.sendStream(stream)`)
 * - Client → Server: used as request body stream (via `client.sendStream(path, stream)`)
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
  private readonly maxPendingChunks?: number;
  private readonly maxPendingBytes?: number;
  private expireTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRemoteActivityAt = Date.now();
  private heartbeatInFlight: Promise<boolean> | null = null;

  /** pull/ack protocol */
  private pullCredit = 0;
  private seq = 0;
  private pendingBytes = 0;
  private readonly pendingQueue: Array<{
    data: any;
    done: boolean;
    requireAck?: boolean;
    ackRequestId?: string;
    ackTimeout?: number;
    resolveAck?: (ok: boolean) => void;
    bytes: number;
  }> = [];
  private pumping = false;
  private completionPromise: Promise<void> | null = null;
  private resolveCompletion: (() => void) | null = null;
  private rejectCompletion: ((err: Error) => void) | null = null;

  private ackWaiters = new Map<string, { resolve: (ok: boolean) => void; timeoutId: ReturnType<typeof setTimeout> }>();
  private ackReceiverRegistered = false;
  private ackReceiver?: (data: any, context: any) => void;

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
    this.maxPendingChunks = options.maxPendingChunks;
    this.maxPendingBytes = options.maxPendingBytes;
  }

  private enqueue(item: {
    data: any;
    done: boolean;
    requireAck?: boolean;
    ackRequestId?: string;
    ackTimeout?: number;
    resolveAck?: (ok: boolean) => void;
  }): void {
    const max = this.maxPendingChunks;
    if (typeof max === 'number' && max > 0 && this.pendingQueue.length >= max) {
      throw new RequestIframeStreamError({
        message: formatMessage(Messages.STREAM_PENDING_QUEUE_OVERFLOW, max),
        code: ErrorCode.STREAM_PENDING_QUEUE_OVERFLOW,
        streamId: this.streamId,
        requestId: this.context?.requestId
      });
    }
    const bytes = this.estimateChunkBytes(item.data);
    const maxBytes = this.maxPendingBytes;
    if (typeof maxBytes === 'number' && maxBytes > 0) {
      const next = this.pendingBytes + bytes;
      if (!Number.isFinite(next) || next > maxBytes) {
        throw new RequestIframeStreamError({
          message: formatMessage(Messages.STREAM_PENDING_BYTES_OVERFLOW, maxBytes),
          code: ErrorCode.STREAM_PENDING_BYTES_OVERFLOW,
          streamId: this.streamId,
          requestId: this.context?.requestId
        });
      }
    }
    this.pendingQueue.push({ ...item, bytes });
    this.pendingBytes += bytes;
  }

  private estimateChunkBytes(data: any): number {
    if (data === null || data === undefined) return 0;
    if (typeof data === 'string') return this.utf8ByteLength(data);

    try {
      // ArrayBuffer
      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        return data.byteLength;
      }
      // TypedArray / DataView
      if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
        return (data as ArrayBufferView).byteLength;
      }
    } catch {
      /** ignore */
    }

    try {
      // Blob / File
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.size;
      }
    } catch {
      /** ignore */
    }

    // Strategy C: only count well-defined types; other values are not counted.
    return 0;
  }

  private utf8ByteLength(text: string): number {
    try {
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(text).length;
      }
    } catch {
      /** ignore */
    }
    try {
      // eslint-disable-next-line no-undef
      if (typeof Buffer !== 'undefined') {
        // eslint-disable-next-line no-undef
        return Buffer.byteLength(text, 'utf8');
      }
    } catch {
      /** ignore */
    }
    return text.length;
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
      throw new RequestIframeStreamError({
        message: Messages.STREAM_NOT_BOUND,
        code: ErrorCode.STREAM_NOT_BOUND,
        streamId: this.streamId
      });
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
    
    /**
     * Transferable optimization:
     * - If payload contains ArrayBuffer/TypedArray, transfer its underlying buffer to avoid copy.
     * - This helps large chunks (e.g. file streams) significantly.
     */
    const payloadData = (data as any)?.data;
    let transfer: Transferable[] | undefined;
    try {
      if (typeof ArrayBuffer !== 'undefined' && payloadData instanceof ArrayBuffer) {
        transfer = [payloadData];
      } else if (
        typeof ArrayBuffer !== 'undefined' &&
        typeof ArrayBuffer.isView === 'function' &&
        payloadData &&
        ArrayBuffer.isView(payloadData) &&
        payloadData.buffer instanceof ArrayBuffer
      ) {
        transfer = [payloadData.buffer];
      }
    } catch {
      /** ignore */
    }

    const ok = (this.context.channel as any).send(this.context.targetWindow, message, this.context.targetOrigin, transfer);
    if (!ok) {
      this._state = StreamStateConstant.CANCELLED;
      this.clearExpireTimer();
      // For most stream messages, if we cannot send, treat as a hard cancellation signal
      // so callers can stop further processing immediately.
      throw new RequestIframeStreamError({
        message: formatMessage(Messages.STREAM_CANCELLED, Messages.TARGET_WINDOW_CLOSED),
        code: ErrorCode.TARGET_WINDOW_CLOSED,
        streamId: this.streamId,
        requestId: this.context.requestId
      });
    }
    return true;
  }

  private ensureAckReceiver(): void {
    if (this.ackReceiverRegistered) return;
    if (!this.context) return;
    const ch: any = this.context.channel as any;
    if (!isFunction(ch.addReceiver) || !isFunction(ch.removeReceiver)) return;

    this.ackReceiver = (data: any, context: any) => {
      if (!data || data.type !== MessageType.ACK) return;
      const pending = this.ackWaiters.get(data.requestId);
      if (!pending) return;
      if (context && !context.handledBy) {
        context.markHandledBy(`stream:${this.streamId}`);
      }
      clearTimeout(pending.timeoutId);
      this.ackWaiters.delete(data.requestId);
      pending.resolve(true);
    };

    ch.addReceiver(this.ackReceiver);
    this.ackReceiverRegistered = true;
  }

  private cleanupAckWaiters(): void {
    this.ackWaiters.forEach((p) => {
      clearTimeout(p.timeoutId);
      p.resolve(false);
    });
    this.ackWaiters.clear();

    if (this.ackReceiverRegistered && this.ackReceiver && this.context) {
      const ch: any = this.context.channel as any;
      if (isFunction(ch.removeReceiver)) {
        try {
          ch.removeReceiver(this.ackReceiver);
        } catch {
          /** ignore */
        }
      }
    }
    this.ackReceiverRegistered = false;
    this.ackReceiver = undefined;
  }

  private registerAckWaiter(requestId: string, timeoutMs: number, resolve: (ok: boolean) => void): void {
    const timeoutId = setTimeout(() => {
      this.ackWaiters.delete(requestId);
      resolve(false);
    }, timeoutMs);
    this.ackWaiters.set(requestId, { resolve, timeoutId });
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
      throw new RequestIframeStreamError({
        message: Messages.STREAM_NOT_BOUND,
        code: ErrorCode.STREAM_NOT_BOUND,
        streamId: this.streamId
      });
    }
    
    if (this._state !== StreamStateConstant.PENDING) {
      throw new RequestIframeStreamError({
        message: Messages.STREAM_ALREADY_STARTED,
        code: ErrorCode.STREAM_ALREADY_STARTED,
        streamId: this.streamId,
        requestId: this.context.requestId
      });
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
  public write(data: any, done?: boolean): void;
  public write(data: any, options: StreamFrameOptions): Promise<boolean>;
  public write(data: any, done: boolean | undefined, options: StreamFrameOptions): Promise<boolean>;
  public write(
    data: any,
    doneOrOptions: boolean | StreamFrameOptions = false,
    options?: StreamFrameOptions
  ): void | Promise<boolean> {
    if (this.mode !== StreamModeConstant.PUSH) {
      throw new RequestIframeStreamError({
        message: Messages.STREAM_WRITE_ONLY_IN_PUSH_MODE,
        code: ErrorCode.STREAM_WRITE_ONLY_IN_PUSH_MODE,
        streamId: this.streamId,
        requestId: this.context?.requestId
      });
    }
    if (this._state === StreamStateConstant.PENDING) {
      /**
       * In push mode, users must call start() first so STREAM_START is sent and binding is complete.
       */
      throw new RequestIframeStreamError({
        message: Messages.STREAM_NOT_BOUND,
        code: ErrorCode.STREAM_NOT_BOUND,
        streamId: this.streamId,
        requestId: this.context?.requestId
      });
    }
    if (this._state !== StreamStateConstant.STREAMING) {
      throw new RequestIframeStreamError({
        message: Messages.STREAM_ENDED,
        code: ErrorCode.STREAM_ENDED,
        streamId: this.streamId,
        requestId: this.context?.requestId
      });
    }

    const done = typeof doneOrOptions === 'boolean' ? doneOrOptions : false;
    const opts = (typeof doneOrOptions === 'object' ? doneOrOptions : options) as StreamFrameOptions | undefined;
    const requireAck = opts?.requireAck === true;
    const ackTimeout = opts?.ackTimeout ?? DefaultTimeout.ACK;

    if (!requireAck) {
      // push mode now buffers and sends based on pull credit
      this.enqueue({ data, done });
      this.emit(StreamEvent.WRITE, { data, done });
      this.flush();
      return;
    }

    return new Promise<boolean>((resolve) => {
      const ackRequestId = generateRequestId();
      this.enqueue({
        data,
        done,
        requireAck: true,
        ackRequestId,
        ackTimeout,
        resolveAck: resolve
      });
      this.emit(StreamEvent.WRITE, { data, done });
      this.flush();
    });
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
        this.enqueue({ data: undefined, done: true });
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
          this.enqueue({ data: r.value, done: false });
          this.flush();
        }
      } else if (this.nextFn) {
        while (this._state === StreamStateConstant.STREAMING) {
          if (this.pullCredit <= 0) break;
          const result = await Promise.resolve(this.nextFn());
          this.enqueue({ data: result.data, done: result.done });
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
  private sendData(
    data: any,
    done: boolean = false,
    options?: { requestId?: string; requireAck?: boolean }
  ): void {
    if (!this.context) {
      throw new RequestIframeStreamError({
        message: Messages.STREAM_NOT_BOUND,
        code: ErrorCode.STREAM_NOT_BOUND,
        streamId: this.streamId
      });
    }
    const seq = this.seq++;

    const isClientStream = this.context.clientId !== undefined && this.context.serverId === undefined;
    const role = isClientStream ? MessageRole.CLIENT : MessageRole.SERVER;
    const creatorId = this.context.serverId ?? this.context.clientId;
    const message = createPostMessage(MessageType.STREAM_DATA as any, options?.requestId ?? this.context.requestId, {
      secretKey: this.context.secretKey,
      requireAck: options?.requireAck,
      /**
       * When per-frame requireAck is enabled, include a unique identifier in ack.
       * - seq is the stream frame sequence number.
       *
       * NOTE: ack is an internal reserved field (not part of public API).
       */
      ack: options?.requireAck ? { id: `${this.streamId}:${seq}` } : undefined,
      body: {
        streamId: this.streamId,
        data: this.encodeData(data),
        done,
        seq
      },
      role,
      creatorId,
      targetId: this.context.targetId
    } as any);

    const ok = this.context.channel.send(this.context.targetWindow, message, this.context.targetOrigin);
    if (!ok) {
      this._state = StreamStateConstant.CANCELLED;
      this.clearExpireTimer();
      throw new RequestIframeStreamError({
        message: formatMessage(Messages.STREAM_CANCELLED, Messages.TARGET_WINDOW_CLOSED),
        code: ErrorCode.TARGET_WINDOW_CLOSED,
        streamId: this.streamId,
        requestId: this.context.requestId
      });
    }
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
      this.pendingBytes -= item.bytes;
      this.pullCredit--;
      try {
        if (item.requireAck && item.ackRequestId && item.resolveAck) {
          this.ensureAckReceiver();
          if (this.ackReceiverRegistered) {
            this.registerAckWaiter(item.ackRequestId, item.ackTimeout ?? DefaultTimeout.ACK, item.resolveAck);
            this.sendData(item.data, item.done, { requestId: item.ackRequestId, requireAck: true });
          } else {
            item.resolveAck(false);
            this.sendData(item.data, item.done);
          }
        } else {
          this.sendData(item.data, item.done);
        }
      } catch (e: any) {
        // send failure treated as cancellation
        this._state = StreamStateConstant.CANCELLED;
        this.clearExpireTimer();
        this.clearIdleTimer();
        this.unregisterControlHandler();
        this.pendingQueue.length = 0;
        this.pendingBytes = 0;
        this.cleanupAckWaiters();
        this.rejectCompletion?.(
          e instanceof Error
            ? e
            : new RequestIframeStreamError({
                message: String(e),
                code: ErrorCode.STREAM_ERROR,
                streamId: this.streamId,
                requestId: this.context?.requestId,
                cause: e
              })
        );
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
    this.pendingQueue.length = 0;
    this.pendingBytes = 0;
    this.sendMessage(MessageType.STREAM_END);
    this.emit(StreamEvent.END);
    this.emit(StreamEvent.STATE, { state: this._state });
    this.cleanupAckWaiters();
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
    this.pendingQueue.length = 0;
    this.pendingBytes = 0;
    this.sendMessage(MessageType.STREAM_ERROR, {
      error: message
    });
    this.emit(StreamEvent.ERROR, {
      error: new RequestIframeStreamError({
        message,
        code: ErrorCode.STREAM_ERROR,
        streamId: this.streamId,
        requestId: this.context?.requestId
      })
    });
    this.emit(StreamEvent.STATE, { state: this._state });
    this.cleanupAckWaiters();
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
    this.pendingQueue.length = 0;
    this.pendingBytes = 0;
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
    this.cleanupAckWaiters();
    this.clearAllListeners();
    this.resolveCompletion?.();
  }
}
