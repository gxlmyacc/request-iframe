/**
 * Protocol version constants
 * Used to identify the protocol version of messages, for compatibility handling in future version upgrades
 * 
 * Version compatibility strategy:
 * - Only check minimum supported version, reject deprecated old versions
 * - Don't check maximum version, as new versions usually maintain backward compatibility with old message formats
 * - This way new version servers can be compatible with old version clients, without forcing client upgrades
 */
export const ProtocolVersion = {
  /** Current protocol version */
  CURRENT: 2,
  /** Minimum supported protocol version (messages below this version will be rejected) */
  MIN_SUPPORTED: 1
} as const;

/**
 * Protocol version type
 */
export type ProtocolVersionValue = typeof ProtocolVersion[keyof typeof ProtocolVersion];

/**
 * Protocol validation result
 */
export interface ProtocolValidationResult {
  /** Whether valid */
  valid: boolean;
  /** Protocol version (if valid) */
  version?: number;
  /** Error message (if invalid) */
  error?: string;
  /** Error code (if invalid) */
  errorCode?: 'INVALID_FORMAT' | 'VERSION_TOO_LOW';
}

/**
 * HTTP status code constants
 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * HTTP status text constants
 */
export const HttpStatusText: Record<number, string> = {
  [HttpStatus.OK]: 'OK',
  [HttpStatus.CREATED]: 'Created',
  [HttpStatus.NO_CONTENT]: 'No Content',
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.REQUEST_TIMEOUT]: 'Request Timeout',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable'
};

/**
 * Get status text
 */
export function getStatusText(code: number): string {
  return HttpStatusText[code] || 'Unknown';
}

/**
 * Error code constants
 */
export const ErrorCode = {
  /** ACK confirmation timeout */
  ACK_TIMEOUT: 'ACK_TIMEOUT',
  /** Request timeout (synchronous) */
  TIMEOUT: 'TIMEOUT',
  /** Async request timeout */
  ASYNC_TIMEOUT: 'ASYNC_TIMEOUT',
  /** Request error */
  REQUEST_ERROR: 'REQUEST_ERROR',
  /** Method not found */
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  /** No response */
  NO_RESPONSE: 'NO_RESPONSE',
  /** Protocol version not supported */
  PROTOCOL_UNSUPPORTED: 'PROTOCOL_UNSUPPORTED',
  /** iframe not ready */
  IFRAME_NOT_READY: 'IFRAME_NOT_READY',
  /** Stream error */
  STREAM_ERROR: 'STREAM_ERROR',
  /** Stream cancelled */
  STREAM_CANCELLED: 'STREAM_CANCELLED',
  /** Stream not bound */
  STREAM_NOT_BOUND: 'STREAM_NOT_BOUND',
  /** Target window closed */
  TARGET_WINDOW_CLOSED: 'TARGET_WINDOW_CLOSED',
  /** Too many concurrent requests (rate limiting) */
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** Stream start not received in time */
  STREAM_START_TIMEOUT: 'STREAM_START_TIMEOUT'
} as const;

/**
 * Message type constants
 */
export const MessageType = {
  /** Request message */
  REQUEST: 'request',
  /** Acknowledge request received */
  ACK: 'ack',
  /** Async task notification */
  ASYNC: 'async',
  /** Response message */
  RESPONSE: 'response',
  /** Error message */
  ERROR: 'error',
  /** Client confirms response received */
  RECEIVED: 'received',
  /** Ping message (for connection detection) */
  PING: 'ping',
  /** Pong message (for connection detection) */
  PONG: 'pong',
  /** Stream start */
  STREAM_START: 'stream_start',
  /** Stream data chunk */
  STREAM_DATA: 'stream_data',
  /** Stream end */
  STREAM_END: 'stream_end',
  /** Stream error */
  STREAM_ERROR: 'stream_error',
  /** Stream cancel */
  STREAM_CANCEL: 'stream_cancel',
  /** Stream pull (receiver requests next chunks) */
  STREAM_PULL: 'stream_pull',
  /** Stream ack (receiver acknowledges a chunk) */
  STREAM_ACK: 'stream_ack'
} as const;

export const MessageRole = {
  /** Server role */
  SERVER: 'server',
  /** Client role */
  CLIENT: 'client'
} as const;

export type MessageRoleValue = typeof MessageRole[keyof typeof MessageRole];

/**
 * Default timeout configuration (milliseconds)
 */
export const DefaultTimeout = {
  /** 
   * ACK confirmation timeout: 1000ms (1s)
   * Used for both client waiting for server ACK and server waiting for client RECEIVED.
   * Increased from 500ms to accommodate slower environments or busy browsers where postMessage
   * serialization/deserialization may take longer.
   */
  ACK: 1000,
  /** Request timeout: 5s */
  REQUEST: 5000,
  /** Async request timeout: 120s */
  ASYNC: 120000
} as const;

/**
 * HTTP Header name constants
 */
export const HttpHeader = {
  /** Set-Cookie (server sets cookie) */
  SET_COOKIE: 'Set-Cookie',
  /** Content-Type */
  CONTENT_TYPE: 'Content-Type',
  /** Content-Disposition (for file downloads) */
  CONTENT_DISPOSITION: 'Content-Disposition',
  /** Authorization */
  AUTHORIZATION: 'Authorization',
  /** Cookie (cookies carried in request) */
  COOKIE: 'Cookie'
} as const;

/**
 * HTTP Header name type
 */
export type HttpHeaderValue = typeof HttpHeader[keyof typeof HttpHeader];

/**
 * Message type union type
 */
export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

/**
 * Error code union type
 */
export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Stream type constants
 */
export const StreamType = {
  /** Normal data stream */
  DATA: 'data',
  /** File stream */
  FILE: 'file'
} as const;

/**
 * Stream mode constants
 * - PULL: receiver pulls next chunks (backpressure)
 * - PUSH: producer pushes via write()
 */
export const StreamMode = {
  PULL: 'pull',
  PUSH: 'push'
} as const;

export type StreamModeValue = typeof StreamMode[keyof typeof StreamMode];

/**
 * Stream internal message type constants (for stream internal message handling)
 * Note: These are MessageType.STREAM_* values with the stream_ prefix removed
 */
export const StreamInternalMessageType = {
  /** Data message */
  DATA: 'data',
  /** End message */
  END: 'end',
  /** Error message */
  ERROR: 'error',
  /** Cancel message */
  CANCEL: 'cancel',
  /** Pull message */
  PULL: 'pull',
  /** Ack message */
  ACK: 'ack'
} as const;

/**
 * Stream internal message type value type
 */
export type StreamInternalMessageTypeValue = typeof StreamInternalMessageType[keyof typeof StreamInternalMessageType];

/**
 * Stream type value type
 */
export type StreamTypeValue = typeof StreamType[keyof typeof StreamType];

/**
 * Stream state constants
 */
export const StreamState = {
  /** Pending */
  PENDING: 'pending',
  /** Streaming */
  STREAMING: 'streaming',
  /** Ended */
  ENDED: 'ended',
  /** Error */
  ERROR: 'error',
  /** Cancelled */
  CANCELLED: 'cancelled'
} as const;

/**
 * Stream state value type
 */
export type StreamStateValue = typeof StreamState[keyof typeof StreamState];

/**
 * Stream event name constants (for stream.on / observability)
 */
export const StreamEvent = {
  START: 'start',
  DATA: 'data',
  READ: 'read',
  WRITE: 'write',
  SEND: 'send',
  PULL: 'pull',
  ACK: 'ack',
  END: 'end',
  CANCEL: 'cancel',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  EXPIRED: 'expired',
  STATE: 'state'
} as const;

export type StreamEventValue = typeof StreamEvent[keyof typeof StreamEvent];

/**
 * Message constants (for multi-language support)
 */
export { Messages, formatMessage, setMessages, resetMessages, getMessages } from './messages';
export type { MessageKey } from './messages';
