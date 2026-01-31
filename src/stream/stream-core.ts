import type {
  StreamState,
  StreamType,
  StreamMessageData,
  WritableStreamMode,
  StreamEventName,
  StreamEventListener
} from './types';
import { StreamState as StreamStateConstant, Messages, StreamEvent } from '../constants';

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

  private listeners = new Map<string, Set<StreamEventListener<any>>>();

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

  /**
   * Subscribe to stream events.
   *
   * This is designed for observability (debugging / metrics / UI progress),
   * and should not be used to drive protocol-critical logic.
   *
   * Returns an unsubscribe function.
   */
  public on<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  public on(event: string, listener: (payload: any) => void): () => void;
  public on(event: string, listener: StreamEventListener<any>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Terminal events: if already reached, fire once immediately for convenience.
    if (event === StreamEvent.END && this._state === StreamStateConstant.ENDED) {
      this.safeCall(listener);
    } else if (event === StreamEvent.ERROR && this._state === StreamStateConstant.ERROR) {
      this.safeCall(listener, { error: this.terminalError });
    } else if (event === StreamEvent.CANCEL && this._state === StreamStateConstant.CANCELLED) {
      this.safeCall(listener, { error: this.terminalError });
    }

    return () => this.off(event, listener);
  }

  public once<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  public once(event: string, listener: (payload: any) => void): () => void;
  public once(event: string, listener: StreamEventListener<any>): () => void {
    // If already terminal, behave like a synchronous one-shot.
    if (event === StreamEvent.END && this._state === StreamStateConstant.ENDED) {
      this.safeCall(listener);
      return () => {};
    }
    if (event === StreamEvent.ERROR && this._state === StreamStateConstant.ERROR) {
      this.safeCall(listener, { error: this.terminalError });
      return () => {};
    }
    if (event === StreamEvent.CANCEL && this._state === StreamStateConstant.CANCELLED) {
      this.safeCall(listener, { error: this.terminalError });
      return () => {};
    }

    const wrapped: StreamEventListener<any> = (payload) => {
      this.off(event, wrapped);
      this.safeCall(listener, payload);
    };
    return this.on(event, wrapped);
  }

  /**
   * Unsubscribe from stream events.
   */
  public off<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): void;
  public off(event: string, listener: (payload: any) => void): void;
  public off(event: string, listener: StreamEventListener<any>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  protected emit(event: string, payload?: any): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot to avoid issues if listeners mutate subscriptions.
    const list = Array.from(set);
    list.forEach((fn) => this.safeCall(fn, payload));
  }

  protected clearAllListeners(): void {
    this.listeners.clear();
  }

  private safeCall(fn: (payload: any) => void, payload?: any): void {
    try {
      fn(payload);
    } catch {
      /** ignore user listener errors */
    }
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
    this.emit(StreamEvent.ERROR, { error });
    this.emit(StreamEvent.STATE, { state: this._state });
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
    this.emit(StreamEvent.CANCEL, { reason, error: this.terminalError });
    this.emit(StreamEvent.STATE, { state: this._state });
    this.notifyWaiters();
  }

  /**
   * Read-side: enqueue a decoded chunk
   */
  protected pushChunk(chunk: T): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    this._state = StreamStateConstant.STREAMING;
    this.chunks.push(chunk);
    this.emit(StreamEvent.DATA, { chunk });
    this.emit(StreamEvent.STATE, { state: this._state });
    this.notifyWaiters();
  }

  /**
   * Read-side: mark end
   */
  protected end(): void {
    if (this._state === StreamStateConstant.ENDED) return;
    this._state = StreamStateConstant.ENDED;
    this.emit(StreamEvent.END);
    this.emit(StreamEvent.STATE, { state: this._state });
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

