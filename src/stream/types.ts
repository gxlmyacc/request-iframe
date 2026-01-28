import { StreamType as StreamTypeConstant, StreamState as StreamStateConstant } from '../constants';
import type { MessageChannel } from '../message';

/**
 * Stream type
 */
export type StreamType = typeof StreamTypeConstant[keyof typeof StreamTypeConstant];

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
  /** Cancel stream transfer */
  cancel(reason?: string): void;
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
  /** Read all data (for non-chunked streams or wait for chunked stream to complete) */
  read(): Promise<T>;
  /** Async iterator (for chunked streams) */
  [Symbol.asyncIterator](): AsyncIterator<T>;
  /** Cancel stream */
  cancel(reason?: string): void;
  /** Listen for stream end */
  onEnd(callback: () => void): void;
  /** Listen for stream error */
  onError(callback: (error: Error) => void): void;
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
  /** Data chunk */
  data?: any;
  /** Whether this is the last chunk */
  done?: boolean;
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
