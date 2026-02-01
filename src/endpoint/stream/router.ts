import type { PostMessageData } from '../../types';
import type { MessageContext } from '../../message';
import type { StreamMessageData } from '../../stream';

/**
 * RequestIframeEndpointStreamRouter
 *
 * A shared stream_* router for both client/server endpoints:
 * - Maintains streamId -> handler mapping
 * - Dispatches incoming stream_* messages to the bound handler
 */
export class RequestIframeEndpointStreamRouter {
  private readonly handledBy: string;
  private readonly handlers = new Map<string, (data: StreamMessageData) => void>();

  public constructor(params: { handledBy: string }) {
    this.handledBy = params.handledBy;
  }

  public register(streamId: string, handler: (data: StreamMessageData) => void): void {
    this.handlers.set(streamId, handler);
  }

  public unregister(streamId: string): void {
    this.handlers.delete(streamId);
  }

  public clear(): void {
    this.handlers.clear();
  }

  /**
   * Dispatch a framework stream_* PostMessageData to its streamId handler.
   *
   * - If context is provided, router will mark accepted/handledBy when handler exists.
   * - If context is omitted, router will skip marking (useful when origin was validated upstream).
   */
  public dispatch(data: PostMessageData, context?: MessageContext): void {
    const body = data.body as StreamMessageData;
    if (!body?.streamId) return;
    const handler = this.handlers.get(body.streamId);
    if (!handler) return;

    if (context && !context.handledBy) {
      context.accepted = true;
      context.handledBy = this.handledBy;
    }

    const messageType = (data.type as string).replace('stream_', '');
    handler({ ...body, type: messageType as any });
  }
}

