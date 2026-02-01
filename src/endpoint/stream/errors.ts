import type { PostMessageData } from '../../types';
import { ErrorCode, HttpStatus, HttpStatusText, Messages, formatMessage } from '../../constants';

/**
 * Build the ERROR payload for stream_start timeout.
 *
 * Used by server-side "request-body stream handshake" when the client fails to send stream_start in time.
 */
export function buildStreamStartTimeoutErrorPayload(params: {
  path: string;
  timeoutMs: number;
  requireAck?: boolean;
  ack?: any;
  targetId?: string;
}): Partial<Omit<PostMessageData, '__requestIframe__' | 'type' | 'requestId' | 'timestamp' | 'role' | 'creatorId'>> {
  return {
    path: params.path,
    error: {
      message: formatMessage(Messages.STREAM_START_TIMEOUT, params.timeoutMs),
      code: ErrorCode.STREAM_START_TIMEOUT
    },
    status: HttpStatus.REQUEST_TIMEOUT,
    statusText: HttpStatusText[HttpStatus.REQUEST_TIMEOUT],
    requireAck: params.requireAck,
    ack: params.ack,
    targetId: params.targetId
  };
}

