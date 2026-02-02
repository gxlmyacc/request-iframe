import type { PostMessageData } from '../../types';
import type { StreamMessageData, StreamMessageHandler } from '../../stream';
import { IframeReadableStream, IframeFileReadableStream } from '../../stream';
import { StreamType as StreamTypeConstant } from '../../constants';

/**
 * Endpoint Stream integration layer (`src/endpoint/stream`)
 *
 * This directory integrates postMessage `stream_*` messages with the stream object system in `src/stream`:
 * - Parses stream_start and creates the corresponding ReadableStream (data/file)
 * - Does NOT implement the stream protocol itself (protocol lives in `src/stream`)
 */

/**
 * Parsed stream_start body info.
 */
export interface StreamStartInfo {
  streamId: string;
  type: string;
  mode?: any;
  chunked: boolean;
  metadata?: Record<string, any>;
  autoResolve: boolean;
}

/**
 * Parse stream_start body with defaults.
 */
export function parseStreamStart(body: any): StreamStartInfo | null {
  const b = body as StreamMessageData;
  if (!b?.streamId) return null;
  return {
    streamId: b.streamId,
    type: (b.type as any) || StreamTypeConstant.DATA,
    mode: (b as any).mode,
    chunked: (b as any).chunked ?? true,
    metadata: (b as any).metadata,
    autoResolve: (b as any).autoResolve ?? false
  };
}

/**
 * Create a readable stream instance from a stream_start message/body.
 *
 * This is shared by:
 * - client side: receiving response stream from server
 * - server side: receiving request-body stream from client
 */
export function createReadableStreamFromStart(params: {
  requestId: string;
  data: PostMessageData;
  handler: StreamMessageHandler;
  secretKey?: string;
  idleTimeout?: number;
  heartbeat?: () => Promise<boolean>;
}): { stream: IframeReadableStream<any> | IframeFileReadableStream; info: StreamStartInfo } | null {
  const info = parseStreamStart(params.data.body);
  if (!info) return null;

  const secretKey = params.secretKey ?? params.data.secretKey;

  if (info.type === StreamTypeConstant.FILE) {
    const fileStream = new IframeFileReadableStream(info.streamId, params.requestId, params.handler, {
      chunked: info.chunked,
      metadata: info.metadata,
      secretKey,
      mode: info.mode,
      idleTimeout: params.idleTimeout,
      heartbeat: params.heartbeat,
      filename: info.metadata?.filename,
      mimeType: info.metadata?.mimeType,
      size: info.metadata?.size
    });
    return { stream: fileStream, info };
  }

  const readableStream = new IframeReadableStream(info.streamId, params.requestId, params.handler, {
    type: info.type as any,
    mode: info.mode,
    chunked: info.chunked,
    metadata: info.metadata,
    secretKey,
    idleTimeout: params.idleTimeout,
    heartbeat: params.heartbeat
  } as any);
  return { stream: readableStream, info };
}

