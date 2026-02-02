import type { PostMessageData } from '../../types';
import type { MessageContext } from '../../message';
import { MessageType } from '../../constants';
import type { RequestIframeEndpointHub } from '../infra/hub';
import type { RequestIframeEndpointOutbox } from '../infra/outbox';

/**
 * RequestIframeEndpointHeartbeat
 *
 * Shared "ping -> wait pong" helper.
 * - Works for both server and client endpoints
 * - Uses core.pending for timeout management
 */
export class RequestIframeEndpointHeartbeat {
  public readonly hub: RequestIframeEndpointHub;
  private readonly pendingBucket: string;
  private readonly handledBy: string;
  private readonly isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
  private readonly warnMissingPendingWhenClosed?: (data: PostMessageData) => void;

  public constructor(params: {
    hub: RequestIframeEndpointHub;
    pendingBucket: string;
    handledBy: string;
    isOriginAllowed?: (data: PostMessageData, context: MessageContext) => boolean;
    warnMissingPendingWhenClosed?: (data: PostMessageData) => void;
  }) {
    this.hub = params.hub;
    this.pendingBucket = params.pendingBucket;
    this.handledBy = params.handledBy;
    this.isOriginAllowed = params.isOriginAllowed;
    this.warnMissingPendingWhenClosed = params.warnMissingPendingWhenClosed;
  }

  /**
   * Send PING and resolve true when PONG arrives, false on timeout.
   */
  public ping(peer: RequestIframeEndpointOutbox, timeoutMs: number, targetId?: string): Promise<boolean> {
    const requestId = `ping_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timeoutId = this.hub.pending.setTimeout(() => {
        this.hub.pending.delete(this.pendingBucket, requestId);
        resolve(false);
      }, timeoutMs);
      this.hub.pending.set(this.pendingBucket, requestId, { resolve, timeoutId });
      peer.sendMessage(MessageType.PING, requestId, { requireAck: true, targetId });
    });
  }

  /**
   * Handle incoming PONG for ping() waiter.
   */
  public handlePong(data: PostMessageData, context: MessageContext): void {
    if (this.isOriginAllowed && !this.isOriginAllowed(data, context)) return;
    const pending = this.hub.pending.get<string, any>(this.pendingBucket, data.requestId);
    if (!pending) {
      if (!this.hub.isOpen) {
        this.warnMissingPendingWhenClosed?.(data);
      }
      return;
    }

    context.markAcceptedBy(this.handledBy);

    this.hub.pending.clearTimeout(pending.timeoutId);
    this.hub.pending.delete(this.pendingBucket, data.requestId);
    pending.resolve(true);
  }
}

