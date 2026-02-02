import type { IframeFileWritableStream } from '../../stream';
import { blobToBase64 } from '../../utils/blob';

/**
 * Endpoint Stream integration layer (`src/endpoint/stream`)
 *
 * This directory integrates postMessage `stream_*` messages with the stream object system in `src/stream`:
 * - Endpoint-side File/Blob -> IframeFileWritableStream adaptation (for sendFile / res.sendFile)
 * - Does NOT implement the stream protocol itself (protocol lives in `src/stream`)
 *
 * Create an IframeFileWritableStream from content.
 *
 * Shared by:
 * - client: sendFile(...) -> sendStream(...)
 * - server response: res.sendFile(...) -> sendStream(...)
 */
export async function createIframeFileWritableStreamFromContent(params: {
  content: string | Blob | File;
  fileName?: string;
  mimeType?: string;
  /** default: false (file is sent in one chunk) */
  chunked?: boolean;
  /** default: true (receiver may auto-resolve) */
  autoResolve?: boolean;
  /** stream filename fallback when fileName cannot be inferred */
  defaultFileName?: string;
  /** mimeType fallback when mimeType cannot be inferred */
  defaultMimeType?: string;
}): Promise<{
  stream: IframeFileWritableStream;
  /** inferred filename (may be undefined if content is not File and fileName not provided) */
  fileName?: string;
  mimeType: string;
}> {
  const { IframeFileWritableStream } = await import('../../stream');

  let mimeType = params.mimeType || params.defaultMimeType || 'application/octet-stream';
  let fileName = params.fileName;

  try {
    if (typeof File !== 'undefined' && params.content instanceof File) {
      mimeType = params.content.type || mimeType;
      fileName = fileName || params.content.name;
    }
  } catch {
    /** ignore */
  }

  try {
    if (!fileName && typeof Blob !== 'undefined' && params.content instanceof Blob) {
      const t = (params.content as any).type;
      if (t) mimeType = t;
    }
  } catch {
    /** ignore */
  }

  const fileContent: string =
    typeof params.content === 'string'
      ? btoa(unescape(encodeURIComponent(params.content)))
      : await blobToBase64(params.content as Blob);

  const streamFileName = fileName || params.defaultFileName || 'file';

  const stream = new IframeFileWritableStream({
    filename: streamFileName,
    mimeType,
    chunked: params.chunked ?? false,
    autoResolve: params.autoResolve ?? true,
    next: async () => {
      return { data: fileContent, done: true };
    }
  });

  return { stream, fileName, mimeType };
}

