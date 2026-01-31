import {
  StreamState,
  ReadableStreamOptions,
  IIframeReadableStream,
  StreamMessageData
} from './types';
import { createPostMessage } from '../utils';
import { MessageType, Messages, StreamType as StreamTypeConstant, StreamState as StreamStateConstant, StreamInternalMessageType, formatMessage, StreamEvent } from '../constants';
import { IframeStreamCore } from './stream-core';

/**
 * Stream message handler interface
 */
export interface StreamMessageHandler {
  /** Register stream message handler */
  registerStreamHandler(streamId: string, handler: (data: StreamMessageData) => void): void;
  /** Unregister handler */
  unregisterStreamHandler(streamId: string): void;
  /** Post message */
  postMessage(message: any): void;
}

/**
 * IframeReadableStream - Client-side readable stream
 * Used to receive stream data sent from the server
 */
export class IframeReadableStream<T = any>
  extends IframeStreamCore<T>
  implements IIframeReadableStream<T> {
  private onEndCallback?: () => void;
  private onErrorCallback?: (error: Error) => void;
  private readonly messageHandler: StreamMessageHandler;
  private readonly requestId: string;
  private readonly secretKey?: string;
  private readonly idleTimeout?: number;
  private readonly heartbeat?: () => Promise<boolean>;
  private heartbeatInFlight: Promise<boolean> | null = null;
  private lastActivityAt = Date.now();
  /** pull/ack protocol */
  private pullScheduled = false;
  private readonly highWaterMark = 16;

  public constructor(
    streamId: string,
    requestId: string,
    messageHandler: StreamMessageHandler,
    options: ReadableStreamOptions = {}
  ) {
    super(
      streamId,
      options.type ?? StreamTypeConstant.DATA,
      options.chunked ?? true,
      options.metadata,
      options.consume ?? true,
      options.mode
    );

    this.requestId = requestId;
    this.messageHandler = messageHandler;
    this.secretKey = options.secretKey;
    this.idleTimeout = options.idleTimeout;
    this.heartbeat = options.heartbeat;
    
    // Register stream message handler
    this.messageHandler.registerStreamHandler(streamId, this.handleStreamMessage.bind(this));
    // Initial pull to start the stream (pull protocol)
    this.requestMore(1);

    // Observable: constructed and ready to receive data
    this.emit(StreamEvent.START, {
      streamId: this.streamId,
      type: this.type,
      chunked: this.chunked,
      mode: this.mode,
      metadata: this.metadata
    });
  }

  private postControl(type: any, body: Record<string, any>): void {
    const message = createPostMessage(type, this.requestId, {
      secretKey: this.secretKey,
      body: { streamId: this.streamId, ...body }
    } as any);
    this.messageHandler.postMessage(message);
  }

  private requestMore(credit: number): void {
    if (!credit || credit <= 0) return;
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    try {
      this.postControl(MessageType.STREAM_PULL as any, { credit });
      this.emit(StreamEvent.PULL, { credit });
    } catch {
      /** ignore */
    }
  }

  private schedulePullIfNeeded(): void {
    if (this.pullScheduled) return;
    this.pullScheduled = true;
    Promise.resolve().then(() => {
      this.pullScheduled = false;
      if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
      const need = Math.max(0, this.highWaterMark - this.chunks.length);
      if (need > 0) {
        this.requestMore(need);
      }
    });
  }

  /** Get stream state */
  public override get state(): StreamState {
    return super.state;
  }

  /**
   * Handle stream message
   */
  private handleStreamMessage(data: StreamMessageData): void {
    // Mark activity on any incoming stream message
    this.lastActivityAt = Date.now();
    switch (data.type as string) {
      case StreamInternalMessageType.DATA:
        this.handleData(data.data, data.done, data.seq);
        break;
      case StreamInternalMessageType.END:
        this.handleEnd();
        break;
      case StreamInternalMessageType.ERROR:
        this.handleError(new Error(data.error || Messages.STREAM_ERROR));
        break;
      case StreamInternalMessageType.CANCEL:
        this.handleCancel(data.reason);
        break;
      case StreamInternalMessageType.PULL:
        // Control messages for writer side; ignore in readable stream
        break;
    }
  }

  /**
   * Handle data chunk (internal method)
   */
  private handleData(data: any, done?: boolean, seq?: number): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.STREAMING;
    const decoded = this.decodeData(data);
    this.chunks.push(decoded);
    this.emit(StreamEvent.DATA, { chunk: decoded, done, seq });
    this.emit(StreamEvent.STATE, { state: this._state });
    this.notifyWaiters();
    this.schedulePullIfNeeded();
    
    if (done) {
      this.handleEnd();
    }
  }

  /**
   * Decode data (subclasses can override, e.g., FileStream needs Base64 decoding)
   */
  protected decodeData(data: any): T {
    return data as T;
  }

  /**
   * Stream ended (internal handling)
   */
  private handleEnd(): void {
    if (this._state === StreamStateConstant.ENDED) return;
    
    super.end();
    this.messageHandler.unregisterStreamHandler(this.streamId);
    this.notifyWaiters();
    
    this.onEndCallback?.();
    this.clearAllListeners();
  }

  /**
   * Merge data chunks (subclasses can override)
   */
  protected mergeChunks(): T {
    if (this.chunks.length === 0) {
      return undefined as T;
    }
    if (this.chunks.length === 1) {
      return this.chunks[0];
    }
    // Default returns array
    return this.chunks as unknown as T;
  }

  /**
   * Stream error (internal method)
   */
  private handleError(error: Error): void {
    if (this._state === StreamStateConstant.ENDED || this._state === StreamStateConstant.ERROR) return;
    
    super.fail(error);
    this.messageHandler.unregisterStreamHandler(this.streamId);
    this.notifyWaiters();
    
    this.onErrorCallback?.(error);
    this.clearAllListeners();
  }

  /**
   * Stream cancelled (internal method)
   */
  private handleCancel(reason?: string): void {
    this.cancelInternal(reason, false);
  }

  /**
   * Cancel/abort core logic
   * @param reason cancel reason
   * @param notifyRemote whether to notify remote side (send stream_cancel)
   */
  private cancelInternal(reason?: string, notifyRemote: boolean = false): void {
    if (
      this._state === StreamStateConstant.ENDED ||
      this._state === StreamStateConstant.ERROR ||
      this._state === StreamStateConstant.CANCELLED
    ) return;

    super.cancel(formatMessage(Messages.STREAM_CANCELLED, reason || ''));
    this.notifyWaiters();
    this.emit(StreamEvent.CANCEL, { reason, remote: notifyRemote });

    if (notifyRemote) {
      try {
        /** Notify server to cancel */
        const message = createPostMessage(MessageType.STREAM_CANCEL as any, this.requestId, {
          secretKey: this.secretKey,
          body: {
            streamId: this.streamId,
            reason
          }
        });
        this.messageHandler.postMessage(message);
      } catch {
        /** ignore send failures on cancel/abort */
      }
    }

    this.messageHandler.unregisterStreamHandler(this.streamId);

    if (this.terminalError) {
      this.onErrorCallback?.(this.terminalError);
    } else {
      this.onErrorCallback?.(new Error(Messages.STREAM_CANCELLED));
    }
    this.clearAllListeners();
  }

  private async performHeartbeat(): Promise<boolean> {
    if (!this.heartbeat) return false;
    if (!this.heartbeatInFlight) {
      this.heartbeatInFlight = Promise.resolve()
        .then(() => this.heartbeat!())
        .catch(() => false)
        .finally(() => {
          this.heartbeatInFlight = null;
        });
    }
    return this.heartbeatInFlight;
  }

  private async waitForChangeWithIdleTimeout(): Promise<void> {
    const state0 = this._state as StreamState;
    if (
      state0 === StreamStateConstant.ENDED ||
      state0 === StreamStateConstant.ERROR ||
      state0 === StreamStateConstant.CANCELLED
    ) {
      return;
    }

    if (!this.idleTimeout || this.idleTimeout <= 0) {
      await this.waitForChange();
      return;
    }

    const snapshot = this.lastActivityAt;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      this.waitForChange(),
      new Promise<void>((resolve) => {
        timerId = setTimeout(resolve, this.idleTimeout);
      })
    ]);
    if (timerId) clearTimeout(timerId);

    // If stream already moved to a terminal state, just return
    const stateAfter = this._state as StreamState;
    if (
      stateAfter === StreamStateConstant.ENDED ||
      stateAfter === StreamStateConstant.ERROR ||
      stateAfter === StreamStateConstant.CANCELLED
    ) {
      return;
    }

    // Activity happened while we were waiting
    if (this.lastActivityAt !== snapshot) {
      return;
    }

    // Idle timeout hit: try heartbeat if available
    const ok = await this.performHeartbeat();
    if (ok) {
      // Treat heartbeat as activity to prevent immediate re-trigger
      this.lastActivityAt = Date.now();
      return;
    }

    // Connection likely dead: fail the stream
    this.emit(StreamEvent.TIMEOUT, { timeout: this.idleTimeout });
    this.handleError(new Error(formatMessage(Messages.STREAM_TIMEOUT, this.idleTimeout)));
  }

  /**
   * Read all data
   */
  public async read(): Promise<T | T[]> {
    if (this._state === StreamStateConstant.ENDED) {
      const merged = this.mergeChunks();
      this.emit(StreamEvent.READ, { value: merged });
      return merged;
    }
    if (this._state === StreamStateConstant.ERROR || this._state === StreamStateConstant.CANCELLED) {
      throw this.terminalError || new Error(Messages.STREAM_READ_ERROR);
    }

    while (this._state === StreamStateConstant.PENDING || this._state === StreamStateConstant.STREAMING) {
      if (this.chunks.length === 0) {
        this.requestMore(1);
      }
      await this.waitForChangeWithIdleTimeout();
    }

    if (this._state === StreamStateConstant.ENDED) {
      const merged = this.mergeChunks();
      this.emit(StreamEvent.READ, { value: merged });
      return merged;
    }
    throw this.terminalError || new Error(Messages.STREAM_READ_ERROR);
  }

  /**
   * Read all chunks as an array
   */
  public async readAll(): Promise<T[]> {
    if (this._state === StreamStateConstant.ENDED) {
      const list = this.chunks.slice();
      this.emit(StreamEvent.READ, { value: list });
      return list;
    }
    if (this._state === StreamStateConstant.ERROR || this._state === StreamStateConstant.CANCELLED) {
      throw this.terminalError || new Error(Messages.STREAM_READ_ERROR);
    }

    while (this._state === StreamStateConstant.PENDING || this._state === StreamStateConstant.STREAMING) {
      this.schedulePullIfNeeded();
      await this.waitForChangeWithIdleTimeout();
    }

    if (this._state === StreamStateConstant.ENDED) {
      const list = this.chunks.slice();
      this.emit(StreamEvent.READ, { value: list });
      return list;
    }
    throw this.terminalError || new Error(Messages.STREAM_READ_ERROR);
  }

  /**
   * Async iterator
   */
  public [Symbol.asyncIterator](): AsyncIterator<T> {
    let index = 0;
    const stream = this;
    
    return {
      async next(): Promise<IteratorResult<T>> {
        // Wait for new data or terminal state
        while (index >= stream.chunks.length) {
          if (
            stream._state === StreamStateConstant.ENDED ||
            stream._state === StreamStateConstant.ERROR ||
            stream._state === StreamStateConstant.CANCELLED
          ) {
            return { done: true, value: undefined as T };
          }
          // Consumer is ready: request at least 1 chunk
          stream.requestMore(1);
          await stream.waitForChangeWithIdleTimeout();
        }
        
        const value = stream.chunks[index++];
        stream.emit(StreamEvent.READ, { value });
        if (stream.consume) {
          /**
           * Drop already-consumed chunks to reduce memory usage.
           * Use compaction (slice) to avoid O(n) shift per chunk.
           */
          if (index > 128) {
            stream.chunks = stream.chunks.slice(index);
            index = 0;
          }
        }
        return { done: false, value };
      }
    };
  }

  /**
   * Abort stream (is alias of cancel method)
   */
  public abort(reason?: string): void {
    this.cancelInternal(reason, true);
  }

  /**
   * Cancel stream
   */
  public cancel(reason?: string): void {
    this.cancelInternal(reason, true);
  }

  /**
   * Listen for stream end
   */
  public onEnd(callback: () => void): void {
    this.onEndCallback = callback;
    if (this._state === StreamStateConstant.ENDED) {
      callback();
    }
  }

  /**
   * Listen for stream error
   */
  public onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
}
