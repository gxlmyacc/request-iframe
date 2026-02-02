import type { PostMessageData } from '../../types';
import type { MessageContext } from '../../message';
import { MessageType } from '../../constants';
import type { RequestIframeEndpointHub } from '../infra/hub';

/**
 * Create a PING responder handler (reply PONG).
 *
 * This is a shared building block for both client/server endpoints.
 */
export function createPingResponder(params: {
  hub: RequestIframeEndpointHub;
  handledBy: string;
  /**
   * Whether to attach `targetId = data.creatorId` when replying PONG.
   * Useful when multiple instances share a channel.
   */
  includeTargetId?: boolean;
}): (data: PostMessageData, context: MessageContext) => void {
  const { hub, handledBy, includeTargetId } = params;
  return (data, context) => {
    if (!context.source) return;
    /** Mark accepted so MessageDispatcher can auto-send ACK when requireAck === true */
    context.markAcceptedBy(handledBy);
    /** Reply PONG */
    hub.messageDispatcher.sendMessage(
      context.source,
      context.origin,
      MessageType.PONG,
      data.requestId,
      includeTargetId ? { targetId: data.creatorId } : undefined
    );
  };
}

