import {
  StreamType as StreamTypeConstant,
  StreamState as StreamStateConstant,
  StreamMode as StreamModeConstant,
  StreamEvent as StreamEventConstant
} from '../constants';
import type { MessageChannel } from '../message';

/**
 * Stream type
 */
export type StreamType = typeof StreamTypeConstant[keyof typeof StreamTypeConstant];

/** Writable stream mode */
export type WritableStreamMode = typeof StreamModeConstant[keyof typeof StreamModeConstant];

/**
 * Stream event name
 */
export type StreamEventName = typeof StreamEventConstant[keyof typeof StreamEventConstant];

/**
 * Stream event payload map (for stream.on/once/off typing)
 */
export type StreamEventPayloadMap = {
  start: {
    streamId: string;
    type: StreamType;
    chunked: boolean;
    mode?: WritableStreamMode;
    metadata?: Record<string, any>;
  };
  data: { chunk: any; done?: boolean; seq?: number };
  read: { value: any };
  write: { data: any; done?: boolean };
  send: { seq: number; done?: boolean };
  pull: { credit: number; totalCredit?: number };
  ack: { seq?: number };
  end: void;
  cancel: { reason?: string; remote?: boolean; error?: Error };
  error: { error?: Error };
  timeout: { timeout?: number };
  expired: { timeout: number };
  state: { state: StreamState };
};

export type StreamEventListener<E extends StreamEventName = StreamEventName> = (
  payload: StreamEventPayloadMap[E]
) => void;

/**
 * Per-frame send/receive options (optional).
 */
export interface StreamFrameOptions {
  /**
   * Whether to require delivery acknowledgment for this frame.
   *
   * When enabled:
   * - the sender attaches `requireAck: true` to the underlying postMessage
   * - the receiver (MessageDispatcher) auto-replies with `ack` after it accepts the message
   * - the returned Promise resolves to true/false
   */
  requireAck?: boolean;
  /** Acknowledgment timeout (ms). Default: DefaultTimeout.ACK */
  ackTimeout?: number;
}

/**
 * Stream data chunk
 */
export interface StreamChunk {
  /** Chunk data */
  data: any;
  /** Whether this is the last chunk */
  done: boolean;
}

/**
 * Writable stream configuration options
 */
export interface WritableStreamOptions {
  /** Stream type: data for regular data, file for files */
  type?: StreamType;
  /** Whether to use chunked transfer (true: multiple transfers, false: single transfer) */
  chunked?: boolean;
  /**
   * Stream mode
   * - pull (default): uses iterator/next to produce chunks
   * - push: user calls write()/end() manually (iterator/next not required)
   */
  mode?: WritableStreamMode;
  /**
   * Stream expire timeout (milliseconds).
   * If set to a positive number, the stream will automatically error out after this duration
   * to avoid leaking resources when the receiver never finishes consuming.
   */
  expireTimeout?: number;
  /**
   * Stream idle timeout (milliseconds) on the writer side.
   * - Used for pull/ack protocol: if the writer does not receive pull/ack within this duration,
   *   it will perform a heartbeat check (if available) and fail the stream if not alive.
   */
  streamTimeout?: number;
  /** Data generator iterator (higher priority than next) */
  iterator?: () => AsyncGenerator<any, void, unknown>;
  /** Data generator function (returns next chunk on each call) */
  next?: () => Promise<StreamChunk> | StreamChunk;
  /** Stream metadata */
  metadata?: Record<string, any>;
  /** 
   * Whether to auto-resolve on client side
   * If true, client will automatically read the stream and return fileData instead of stream
   */
  autoResolve?: boolean;
  /**
   * Maximum number of pending (unsent) chunks kept in memory on the writer side.
   *
   * This is especially useful for long-lived `push` streams when the receiver stops pulling
   * (e.g. tab hidden/backgrounded): the writer-side `pendingQueue` may grow without bound if
   * user code keeps calling write().
   *
   * - When enabled (value > 0), exceeding the limit will cause write()/producer to throw.
   * - Default: unlimited.
   */
  maxPendingChunks?: number;
  /**
   * Maximum bytes of pending (unsent) chunks kept in memory on the writer side.
   *
   * Notes:
   * - Only counts well-defined types: string / ArrayBuffer / TypedArray(DataView) / Blob / File.
   * - For other values (plain objects), the size is treated as 0 (not counted). If you need
   *   byte-level backpressure for objects, stringify them yourself before write().
   *
   * Default: unlimited.
   */
  maxPendingBytes?: number;
}

/**
 * Readable stream configuration options
 */
export interface ReadableStreamOptions {
  /** Stream type */
  type?: StreamType;
  /** Whether to use chunked transfer */
  chunked?: boolean;
  /** Stream metadata */
  metadata?: Record<string, any>;
  /** secretKey (for generating outgoing stream control messages like stream_cancel) */
  secretKey?: string;
  /**
   * Idle timeout (milliseconds) while waiting for new stream data.
   * - When triggered, the stream may perform a heartbeat check (if provided).
   */
  idleTimeout?: number;
  /**
   * Heartbeat function used during idle timeout.
   * - Should resolve true if connection is still alive, otherwise false.
   */
  heartbeat?: () => Promise<boolean>;
  /**
   * Whether to discard already-consumed chunks during async iteration to reduce memory usage.
   * Default is false (keeps all chunks, useful for read()/readAll()).
   */
  consume?: boolean;
  /**
   * Stream mode from the sender (optional).
   * - Populated from stream_start so receiver can make decisions.
   */
  mode?: WritableStreamMode;
}

/**
 * File writable stream configuration options
 */
export interface FileWritableStreamOptions extends Omit<WritableStreamOptions, 'type'> {
  /** Filename */
  filename: string;
  /** MIME type */
  mimeType?: string;
  /** File size (optional, used for progress calculation) */
  size?: number;
}

/**
 * File readable stream configuration options
 */
export interface FileReadableStreamOptions extends Omit<ReadableStreamOptions, 'type'> {
  /** Filename */
  filename?: string;
  /** MIME type */
  mimeType?: string;
  /** File size */
  size?: number;
}

/**
 * Stream bind context (associates request information)
 */
export interface StreamBindContext {
  /** Request ID */
  requestId: string;
  /** Target window */
  targetWindow: Window;
  /** Target origin */
  targetOrigin: string;
  /** secretKey */
  secretKey?: string;
  /** MessageChannel for sending messages */
  channel: MessageChannel;
  /**
   * Register stream control message handler (for pull/ack/cancel) on the owner side.
   * This allows writable streams to receive `stream_*` control messages routed by core client/server.
   */
  registerStreamHandler?: (streamId: string, handler: (data: StreamMessageData) => void) => void;
  /** Unregister stream handler */
  unregisterStreamHandler?: (streamId: string) => void;
  /**
   * Heartbeat function used by streamTimeout on writer side (optional).
   * Should resolve true if connection is alive.
   */
  heartbeat?: () => Promise<boolean>;
  /** Server instance ID (for server-side streams, used as creatorId) */
  serverId?: string;
  /** Client instance ID (for client-side streams, used as creatorId) */
  clientId?: string;
  /** Target instance ID (for routing messages to the correct instance) */
  targetId?: string;
}

/**
 * Stream state
 */
export type StreamState = typeof StreamStateConstant[keyof typeof StreamStateConstant];

/**
 * Writable stream interface (server-side)
 */
export interface IIframeWritableStream {
  /** Stream ID */
  readonly streamId: string;
  /** Stream type */
  readonly type: StreamType;
  /** Whether chunked */
  readonly chunked: boolean;
  /** Stream state */
  readonly state: StreamState;
  /** Bind to request context */
  _bind(context: StreamBindContext): void;
  /** Start stream transfer */
  start(): Promise<void>;
  /**
   * Push a chunk manually (only meaningful when mode === 'push').
   * @param data Chunk payload
   * @param done Whether this is the last chunk
   */
  write(data: any, done?: boolean): void;
  write(data: any, options: StreamFrameOptions): Promise<boolean>;
  write(data: any, done: boolean | undefined, options: StreamFrameOptions): Promise<boolean>;
  /**
   * End the stream (only meaningful when mode === 'push').
   */
  end(): void;
  /** Abort stream transfer */
  abort(reason?: string): void;
  /** Cancel stream transfer */
  cancel(reason?: string): void;
  /**
   * Subscribe to stream events (debug/observability).
   * Returns an unsubscribe function.
   */
  on<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  once<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  off<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): void;
}

/**
 * Readable stream interface (client-side)
 */
export interface IIframeReadableStream<T = any> {
  /** Stream ID */
  readonly streamId: string;
  /** Stream type */
  readonly type: StreamType;
  /** Whether chunked */
  readonly chunked: boolean;
  /** Stream state */
  readonly state: StreamState;
  /** Stream metadata */
  readonly metadata?: Record<string, any>;
  /**
   * Stream mode from the sender (if provided).
   */
  readonly mode?: WritableStreamMode;
  /**
   * Read all data (waits until the stream ends).
   * - Non-chunked streams typically resolve to a single chunk (T)
   * - Chunked streams may resolve to T[] (depending on stream implementation)
   */
  read(): Promise<T | T[]>;
  /**
   * Read all chunks as an array (always returns T[]).
   * Useful for chunked streams when you want a consistent return type.
   */
  readAll(): Promise<T[]>;
  /** Async iterator (for chunked streams) */
  [Symbol.asyncIterator](): AsyncIterator<T>;
  /** Abort stream */
  abort(reason?: string): void;
  /** Cancel stream */
  cancel(reason?: string): void;
  /** Listen for stream end */
  onEnd(callback: () => void): void;
  /** Listen for stream error */
  onError(callback: (error: Error) => void): void;
  /**
   * Subscribe to stream events (debug/observability).
   * Returns an unsubscribe function.
   */
  on<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  once<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): () => void;
  off<E extends StreamEventName>(event: E, listener: StreamEventListener<E>): void;
}

/**
 * File readable stream interface
 */
export interface IIframeFileReadableStream extends IIframeReadableStream<Uint8Array> {
  /** Filename */
  readonly filename?: string;
  /** MIME type */
  readonly mimeType?: string;
  /** File size */
  readonly size?: number;
  /** Read as Blob */
  readAsBlob(): Promise<Blob>;
  /** Read as File */
  readAsFile(fileName?: string): Promise<File>;
  /** Read as ArrayBuffer */
  readAsArrayBuffer(): Promise<ArrayBuffer>;
  /** Read as Data URL */
  readAsDataURL(): Promise<string>;
}

/**
 * Stream message data
 */
export interface StreamMessageData {
  /** Stream ID */
  streamId: string;
  /** Stream type */
  type?: StreamType;
  /** Whether chunked */
  chunked?: boolean;
  /** Stream mode (provided by stream_start) */
  mode?: WritableStreamMode;
  /** Data chunk */
  data?: any;
  /** Chunk sequence number (used for data chunk identification) */
  seq?: number;
  /** Whether this is the last chunk */
  done?: boolean;
  /** Pull credit (how many chunks requested) */
  credit?: number;
  /** reserved */
  /** Error message */
  error?: string;
  /** Cancel reason */
  reason?: string;
  /** Metadata */
  metadata?: Record<string, any>;
  /** 
   * Whether to auto-resolve on client side
   * If true, client will automatically read the stream and return fileData instead of stream
   */
  autoResolve?: boolean;
}
