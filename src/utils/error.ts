import { ErrorResponse } from '../types';

/**
 * Custom Error class for request-iframe errors
 * Extends native Error with additional error response fields
 */
export class RequestIframeError extends Error implements ErrorResponse {
  /** Error code */
  public readonly code?: string;
  /** Request configuration */
  public readonly config?: import('../types').RequestConfig;
  /** Response data (if available) */
  public readonly response?: {
    data: any;
    status: number;
    statusText: string;
  };
  /** Request ID */
  public readonly requestId?: string;

  constructor(error: ErrorResponse) {
    super(error.message);
    this.name = 'RequestIframeError';
    this.code = error.code;
    this.config = error.config;
    this.response = error.response;
    this.requestId = error.requestId;
    
    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestIframeError);
    }
  }
}
