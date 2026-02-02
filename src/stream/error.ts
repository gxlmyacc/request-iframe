import { ErrorCode } from '../constants';

export type RequestIframeStreamErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface RequestIframeStreamErrorParams {
  message: string;
  code: RequestIframeStreamErrorCode;
  streamId?: string;
  requestId?: string;
  cause?: any;
}

/**
 * Stream-specific error type.
 *
 * Notes:
 * - This is for stream lifecycle / protocol / binding errors (not request/response errors).
 * - Use `RequestIframeError` for request/response level failures.
 */
export class RequestIframeStreamError extends Error {
  public readonly code: RequestIframeStreamErrorCode;
  public readonly streamId?: string;
  public readonly requestId?: string;
  public readonly cause?: any;

  public constructor(params: RequestIframeStreamErrorParams) {
    super(params.message);
    this.name = 'RequestIframeStreamError';
    this.code = params.code;
    this.streamId = params.streamId;
    this.requestId = params.requestId;
    this.cause = params.cause;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestIframeStreamError);
    }
  }
}

