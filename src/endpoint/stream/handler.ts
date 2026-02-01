import type { StreamMessageData, StreamMessageHandler } from '../../stream';
import type { RequestIframeEndpointStreamRouter } from './router';

/**
 * Create a StreamMessageHandler bound to a stream router and a postMessage implementation.
 *
 * This is shared by:
 * - server side: receiving request-body streams (per request targetWindow/targetOrigin)
 * - client side: can also use it in the future to avoid implementing the interface on the client class
 */
export function createStreamMessageHandler(params: {
  router: RequestIframeEndpointStreamRouter;
  postMessage: (message: any) => void;
}): StreamMessageHandler {
  return {
    registerStreamHandler: (streamId: string, handler: (d: StreamMessageData) => void) => {
      params.router.register(streamId, handler);
    },
    unregisterStreamHandler: (streamId: string) => {
      params.router.unregister(streamId);
    },
    postMessage: (message: any) => {
      params.postMessage(message);
    }
  };
}

