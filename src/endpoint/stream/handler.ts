import type { StreamMessageData, StreamMessageHandler } from '../../stream';
import type { RequestIframeStreamDispatcher } from './dispatcher';

/**
 * Endpoint Stream integration layer (`src/endpoint/stream`)
 *
 * This directory integrates postMessage `stream_*` messages with the stream object system in `src/stream`:
 * - Adapts (dispatcher + postMessage) into the `StreamMessageHandler` interface used by `src/stream`
 * - Does NOT implement the stream protocol itself (protocol lives in `src/stream`)
 *
 * Create a StreamMessageHandler bound to a stream dispatcher and a postMessage implementation.
 *
 * This is shared by:
 * - server side: receiving request-body streams (per request targetWindow/targetOrigin)
 * - client side: can also use it in the future to avoid implementing the interface on the client class
 */
export function createStreamMessageHandler(params: {
  dispatcher: RequestIframeStreamDispatcher;
  postMessage: (message: any) => void;
}): StreamMessageHandler {
  return {
    registerStreamHandler: (streamId: string, handler: (d: StreamMessageData) => void) => {
      params.dispatcher.register(streamId, handler);
    },
    unregisterStreamHandler: (streamId: string) => {
      params.dispatcher.unregister(streamId);
    },
    postMessage: (message: any) => {
      params.postMessage(message);
    }
  };
}

