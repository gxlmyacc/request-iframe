import { IframeWritableStream } from './writable-stream';
import { IframeReadableStream, StreamMessageHandler } from './readable-stream';
import {
  FileWritableStreamOptions,
  FileReadableStreamOptions,
  IIframeFileReadableStream
} from './types';
import { StreamType as StreamTypeConstant } from '../constants';
import { blobToArrayBuffer } from '../utils/blob';

const DEFAULT_FILE_CHUNK_SIZE = 256 * 1024; // 256KB

/**
 * Convert Uint8Array to Base64 string
 */
function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  /**
   * Avoid O(n^2) string concatenation for large buffers.
   * Note: btoa still needs a single binary string, so this mainly improves conversion cost.
   */
  const chunkSize = 0x8000; // 32KB per chunk (safe for fromCharCode/apply limits)
  const parts: string[] = [];
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  return btoa(parts.join(''));
}

/**
 * Convert string to UTF-8 bytes.
 *
 * Notes:
 * - We prefer TextEncoder when available.
 * - Fallback uses `unescape(encodeURIComponent(...))` for broad browser compatibility.
 */
function stringToUtf8Uint8Array(value: string): Uint8Array {
  try {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value);
    }
  } catch {
    /** ignore */
  }
  const latin1 = unescape(encodeURIComponent(value));
  const arr = new Uint8Array(latin1.length);
  for (let i = 0; i < latin1.length; i++) {
    arr[i] = latin1.charCodeAt(i);
  }
  return arr;
}

/**
 * Convert UTF-8 bytes to string.
 *
 * Notes:
 * - We prefer TextDecoder when available.
 * - Fallback uses `escape/decodeURIComponent` for broad browser compatibility.
 */
function utf8Uint8ArrayToString(bytes: Uint8Array): string {
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch {
    /** ignore */
  }
  /**
   * Fallback:
   * - Build a latin1 string from bytes, then decode as UTF-8.
   * - We chunk to avoid call stack / argument limits.
   */
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  return decodeURIComponent(escape(parts.join('')));
}

/**
 * IframeFileWritableStream - Server-side file writable stream
 *
 * Notes:
 * - This stream supports binary chunks (ArrayBuffer / Uint8Array), which can be transferred
 *   via postMessage transfer list for better performance.
 */
export class IframeFileWritableStream extends IframeWritableStream {
  public readonly filename: string;
  public readonly mimeType: string;
  public readonly size?: number;

  /**
   * Create a file writable stream from string/Blob/File.
   *
   * This is a stream-layer utility:
   * - It does NOT depend on headers.
   * - It produces binary chunks (ArrayBuffer) for better performance.
   */
  public static async from(params: {
    content: string | Blob | File;
    fileName?: string;
    mimeType?: string;
    /** default: false (file is sent in one chunk) */
    chunked?: boolean;
    /** Chunk size in bytes (only used when chunked is true). Default: 256KB. */
    chunkSize?: number;
    /** default: true (receiver may auto-resolve) */
    autoResolve?: boolean;
    /** stream filename fallback when fileName cannot be inferred */
    defaultFileName?: string;
    /** mimeType fallback when mimeType cannot be inferred */
    defaultMimeType?: string;
  }): Promise<IframeFileWritableStream> {
    let mimeType = params.mimeType || params.defaultMimeType || 'application/octet-stream';
    let fileName = params.fileName;
    let size: number | undefined;

    try {
      if (typeof File !== 'undefined' && params.content instanceof File) {
        mimeType = params.content.type || mimeType;
        fileName = fileName || params.content.name;
        size = params.content.size;
      }
    } catch {
      /** ignore */
    }

    try {
      if (!fileName && typeof Blob !== 'undefined' && params.content instanceof Blob) {
        const t = (params.content as any).type;
        if (t) mimeType = t;
        size = (params.content as any).size;
      }
    } catch {
      /** ignore */
    }

    const blob: Blob =
      typeof params.content === 'string'
        ? new Blob([params.content], { type: mimeType })
        : (params.content as Blob);
    size = size ?? (blob as any)?.size;

    const streamFileName = fileName || params.defaultFileName || 'file';

    const chunked = params.chunked ?? false;
    const chunkSize =
      typeof params.chunkSize === 'number' && Number.isFinite(params.chunkSize) && params.chunkSize > 0
        ? Math.floor(params.chunkSize)
        : DEFAULT_FILE_CHUNK_SIZE;

    let offset = 0;

    const stream = new IframeFileWritableStream({
      filename: streamFileName,
      mimeType,
      size,
      chunked,
      autoResolve: params.autoResolve ?? true,
      next: async () => {
        if (!chunked) {
          const all = await blobToArrayBuffer(blob);
          return { data: all, done: true };
        }

        const total = (blob as any).size ?? 0;
        if (offset >= total) {
          return { data: new ArrayBuffer(0), done: true };
        }

        const end = Math.min(total, offset + chunkSize);
        const slice = blob.slice(offset, end);
        const buf = await blobToArrayBuffer(slice);
        offset = end;
        return { data: buf, done: offset >= total };
      }
    });

    return stream;
  }

  /**
   * Create a UTF-8 text file stream.
   *
   * This is a convenience wrapper around from({ content: string, ... }):
   * - Makes "string -> UTF-8 bytes -> file stream" intent explicit.
   * - Sets a more appropriate default mimeType for text files.
   */
  public static async fromText(params: {
    text: string;
    fileName?: string;
    /** default: text/plain; charset=utf-8 */
    mimeType?: string;
    /** default: false (file is sent in one chunk) */
    chunked?: boolean;
    /** Chunk size in bytes (only used when chunked is true). Default: 256KB. */
    chunkSize?: number;
    /** default: true (receiver may auto-resolve) */
    autoResolve?: boolean;
    /** stream filename fallback when fileName is not provided */
    defaultFileName?: string;
  }): Promise<IframeFileWritableStream> {
    return await IframeFileWritableStream.from({
      content: params.text,
      fileName: params.fileName,
      mimeType: params.mimeType ?? 'text/plain; charset=utf-8',
      chunked: params.chunked,
      chunkSize: params.chunkSize,
      autoResolve: params.autoResolve,
      defaultFileName: params.defaultFileName ?? 'file.txt',
      defaultMimeType: 'text/plain; charset=utf-8'
    });
  }

  public constructor(options: FileWritableStreamOptions) {
    super({
      ...options,
      type: StreamTypeConstant.FILE,
      metadata: {
        ...options.metadata,
        filename: options.filename,
        mimeType: options.mimeType || 'application/octet-stream',
        size: options.size
      }
    });
    
    this.filename = options.filename;
    this.mimeType = options.mimeType || 'application/octet-stream';
    this.size = options.size;
  }

  /**
   * Encode outbound chunk.
   *
   * - ArrayBuffer / TypedArray: keep as-is (binary chunks)
   * - string: encoded as UTF-8 bytes
   */
  protected encodeData(data: any): any {
    try {
      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        return data;
      }
      if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
        return data;
      }
    } catch {
      /** ignore */
    }
    if (typeof data === 'string') {
      return stringToUtf8Uint8Array(data);
    }
    return stringToUtf8Uint8Array(String(data));
  }
}

/**
 * IframeFileReadableStream - Client-side file readable stream
 * Automatically normalizes inbound chunks to Uint8Array.
 */
export class IframeFileReadableStream 
  extends IframeReadableStream<Uint8Array> 
  implements IIframeFileReadableStream {
  
  public readonly filename?: string;
  public readonly mimeType?: string;
  public readonly size?: number;

  public constructor(
    streamId: string,
    requestId: string,
    messageHandler: StreamMessageHandler,
    options: FileReadableStreamOptions = {}
  ) {
    super(streamId, requestId, messageHandler, {
      ...options,
      type: StreamTypeConstant.FILE
    });
    
    this.filename = options.filename || options.metadata?.filename;
    this.mimeType = options.mimeType || options.metadata?.mimeType;
    this.size = options.size || options.metadata?.size;
  }

  /**
   * Override decode method to normalize chunk to Uint8Array.
   */
  protected decodeData(data: any): Uint8Array {
    if (typeof data === 'string') {
      return stringToUtf8Uint8Array(data);
    }
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    return new Uint8Array();
  }

  /**
   * Parse filename from Content-Disposition header value.
   */
  public static parseFilenameFromContentDisposition(value?: string | string[]): string | undefined {
    if (!value) return undefined;
    const disposition = typeof value === 'string' ? value : value[0];
    if (!disposition) return undefined;
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return match ? match[1] : undefined;
  }

  /**
   * Resolve this file stream to File or Blob, depending on whether fileName is provided.
   */
  public readAsFileOrBlob(fileName?: string): Promise<File | Blob> {
    return fileName ? this.readAsFile(fileName) : this.readAsBlob();
  }

  /**
   * Override merge method to merge all Uint8Array chunks
   */
  protected mergeChunks(): Uint8Array {
    const chunks = (this as any).chunks as Uint8Array[];
    if (chunks.length === 0) {
      return new Uint8Array();
    }
    if (chunks.length === 1) {
      return chunks[0];
    }
    
    // Calculate total length
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    
    // Merge all chunks
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return result;
  }

  /**
   * Read all data as a merged Uint8Array (file stream default behavior)
   */
  public async read(): Promise<Uint8Array> {
    return (await super.read()) as Uint8Array;
  }

  /**
   * Read as Blob
   */
  public async readAsBlob(): Promise<Blob> {
    const data = await this.read();
    // Use slice to create a pure ArrayBuffer copy to avoid type issues
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: this.mimeType || 'application/octet-stream' });
  }

  /**
   * Read as UTF-8 text.
   *
   * Notes:
   * - This is intended for "text file" use cases where file stream chunks represent UTF-8 bytes.
   * - For non-UTF-8 binary files, use readAsBlob()/readAsArrayBuffer().
   */
  public async readAsText(): Promise<string> {
    const data = await this.read();
    return utf8Uint8ArrayToString(data);
  }

  /**
   * Read as File
   * @param fileName Optional file name (if not provided, uses stream's filename)
   */
  public async readAsFile(fileName?: string): Promise<File> {
    const data = await this.read();
    // Use slice to create a pure ArrayBuffer copy to avoid type issues
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const name = fileName || this.filename || 'file';
    return new File([buffer], name, { type: this.mimeType || 'application/octet-stream' });
  }

  /**
   * Read as ArrayBuffer
   */
  public async readAsArrayBuffer(): Promise<ArrayBuffer> {
    const data = await this.read();
    // Create a new ArrayBuffer copy
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    return buffer;
  }

  /**
   * Read as Data URL
   */
  public async readAsDataURL(): Promise<string> {
    const data = await this.read();
    const base64 = uint8ArrayToBase64(data);
    return `data:${this.mimeType || 'application/octet-stream'};base64,${base64}`;
  }
}
