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
import { IframeFileReadableStream, IframeFileWritableStream } from './file-stream';
import { IframeWritableStream } from './writable-stream';
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
export function isIframeFileReadableStream(value: any): value is IIframeFileReadableStream {
  return value instanceof IframeFileReadableStream;
}

/**
 * Check if value is an IframeWritableStream (includes IframeFileWritableStream)
 */
export function isIframeWritableStream(value: any): value is IframeWritableStream {
  return value instanceof IframeWritableStream || value instanceof IframeFileWritableStream;
}

/**
 * Check if value is an IframeFileWritableStream (file writable stream)
 */
export function isIframeFileWritableStream(value: any): value is IframeFileWritableStream {
  return value instanceof IframeFileWritableStream;
}
