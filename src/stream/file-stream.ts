import { IframeWritableStream } from './writable-stream';
import { IframeReadableStream, StreamMessageHandler } from './readable-stream';
import {
  FileWritableStreamOptions,
  FileReadableStreamOptions,
  IIframeFileReadableStream
} from './types';
import { StreamType as StreamTypeConstant } from '../constants';

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
 * Convert Base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const uint8Array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8Array[i] = binary.charCodeAt(i);
  }
  return uint8Array;
}

/**
 * IframeFileWritableStream - Server-side file writable stream
 * Automatically handles Base64 encoding of file content
 */
export class IframeFileWritableStream extends IframeWritableStream {
  public readonly filename: string;
  public readonly mimeType: string;
  public readonly size?: number;

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
   * Override encode method to convert Uint8Array to Base64
   */
  protected encodeData(data: any): string {
    if (data instanceof Uint8Array) {
      return uint8ArrayToBase64(data);
    }
    if (data instanceof ArrayBuffer) {
      return uint8ArrayToBase64(new Uint8Array(data));
    }
    if (typeof data === 'string') {
      // Already a base64 string
      return data;
    }
    // Try to convert other types
    return String(data);
  }
}

/**
 * IframeFileReadableStream - Client-side file readable stream
 * Automatically handles Base64 decoding of file content
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
   * Override decode method to convert Base64 to Uint8Array
   */
  protected decodeData(data: any): Uint8Array {
    if (typeof data === 'string') {
      return base64ToUint8Array(data);
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
