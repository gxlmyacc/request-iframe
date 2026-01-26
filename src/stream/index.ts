// Type exports
export * from './types';

// Writable stream (server-side)
export { IframeWritableStream } from './writable-stream';
export { IframeFileWritableStream } from './file-stream';

// Readable stream (client-side)
export { IframeReadableStream, StreamMessageHandler } from './readable-stream';
export { IframeFileReadableStream } from './file-stream';

// Type checking utility functions
import { IframeReadableStream } from './readable-stream';
import { IframeFileReadableStream } from './file-stream';
import { IIframeReadableStream, IIframeFileReadableStream } from './types';

/**
 * Check if value is an IframeReadableStream
 */
export function isIframeReadableStream(value: any): value is IIframeReadableStream {
  return value instanceof IframeReadableStream;
}

/**
 * Check if value is an IframeFileReadableStream (file stream)
 */
export function isIframeFileStream(value: any): value is IIframeFileReadableStream {
  return value instanceof IframeFileReadableStream;
}
