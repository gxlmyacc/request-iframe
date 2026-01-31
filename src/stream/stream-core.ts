import type { StreamState, StreamType, StreamMessageData, WritableStreamMode } from './types';
import { StreamState as StreamStateConstant, Messages } from '../constants';

/**
 * Shared stream core (internal).
 *
 * - Read side: buffer + waiters + consume compaction
 * - Common: state + terminal error + basic waiter mechanics
 *
 * NOTE:
 * This is an internal abstraction to share logic between Readable/Writable streams.
 * Public API remains `IframeReadableStream` / `IframeWritableStream`.
 */
export class IframeStreamCore<T = any> {
  public readonly streamId: string;
  public readonly type: StreamType;
  public readonly chunked: boolean;
  public readonly metadata?: Record<string, any>;
  public readonly mode?: WritableStreamMode;

  protected _state: StreamState = StreamStateConstant.PENDING;
  protected terminalError?: Error;

  protected chunks: T[] = [];
  protected waiters: Array<() => void> = [];

  protected consume: boolean;

  public constructor(
    streamId: string,
    type: StreamType,
    chunked: boolean,
    metadata: Record<string, any> | undefined,
    consume: boolean,
    mode?: WritableStreamMode
  ) {
    this.streamId = streamId;
    this.type = type;
    this.chunked = chunked;
    this.metadata = metadata;
    this.consume = consume;
    this.mode = mode;
  }

  public get state(): StreamState {
    return this._state;
  }

  protected notifyWaiters(): void {
    if (this.waiters.length === 0) return;
    const list = this.waiters;
    this.waiters = [];
    list.forEach((fn) => {
      try {
        fn();
      } catch {
        /** ignore */
      }
    });
  }

  protected waitForChange(): Promise<void> {
    if (
      this._state === StreamStateConstant.ENDED ||
      this._state === StreamStateConstant.ERROR ||
      this._state === StreamStateConstant.CANCELLED
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  protected fail(error: Error): void {
    if (this._state === StreamStateConstant.ENDED || this._state === StreamStateConstant.ERROR) return;
    this._state = StreamStateConstant.ERROR;
    this.terminalError = error;
    this.notifyWaiters();
  }

  protected cancel(reason?: string): void {
    if (
      this._state === StreamStateConstant.ENDED ||
      this._state === StreamStateConstant.ERROR ||
      this._state === StreamStateConstant.CANCELLED
    ) return;
    this._state = StreamStateConstant.CANCELLED;
    this.terminalError = new Error(reason || Messages.STREAM_CANCELLED);
    this.notifyWaiters();
  }

  /**
   * Read-side: enqueue a decoded chunk
   */
  protected pushChunk(chunk: T): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    this._state = StreamStateConstant.STREAMING;
    this.chunks.push(chunk);
    this.notifyWaiters();
  }

  /**
   * Read-side: mark end
   */
  protected end(): void {
    if (this._state === StreamStateConstant.ENDED) return;
    this._state = StreamStateConstant.ENDED;
    this.notifyWaiters();
  }

  /**
   * Handle inbound message (shared).
   * - ReadableStream will use DATA/END/ERROR/CANCEL
   * - WritableStream may use PULL/ACK/CANCEL separately, so this is intentionally minimal.
   */
  public handleInboundMessage(_data: StreamMessageData): void {
    // Intentionally left blank in core.
  }
}

