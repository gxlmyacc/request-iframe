import type { StreamStartInfo } from './factory';
import { HttpHeader } from '../../constants';
import { IframeFileReadableStream } from '../../stream';

/**
 * Endpoint Stream integration layer (`src/endpoint/stream`)
 *
 * This directory integrates postMessage `stream_*` messages with the stream object system in `src/stream`:
 * - Endpoint-side file stream utilities (e.g. choose filename from header/metadata and auto-resolve)
 * - Does NOT implement the stream protocol itself (protocol lives in `src/stream`)
 *
 * Parse filename from Content-Disposition header.
 */
export function parseFilenameFromContentDisposition(value?: string | string[]): string | undefined {
  return IframeFileReadableStream.parseFilenameFromContentDisposition(value);
}

/**
 * Auto resolve a file readable stream to File/Blob.
 *
 * Filename priority:
 * - Content-Disposition filename (if provided)
 * - stream_start metadata filename (if provided)
 * - stream.filename (if provided)
 */
export function autoResolveIframeFileReadableStream(params: {
  fileStream: IframeFileReadableStream;
  info?: StreamStartInfo | null;
  headers?: Record<string, string | string[]>;
}): Promise<File | Blob> {
  const headerFilename = parseFilenameFromContentDisposition(params.headers?.[HttpHeader.CONTENT_DISPOSITION]);
  const fileName = headerFilename || params.info?.metadata?.filename || params.fileStream.filename;
  const anyStream: any = params.fileStream as any;
  if (typeof anyStream.readAsFileOrBlob === 'function') {
    return anyStream.readAsFileOrBlob(fileName);
  }
  // Backward-compatible fallback for mocks/older stream objects
  return fileName ? anyStream.readAsFile(fileName) : anyStream.readAsBlob();
}

