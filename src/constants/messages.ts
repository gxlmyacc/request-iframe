/**
 * Message constants (for multi-language support)
 * 
 * Usage:
 * 1. Direct use: Messages.REQUEST_FAILED
 * 2. Messages with parameters: Messages.formatMessage(Messages.CONNECT_TIMEOUT, timeout)
 * 
 * Multi-language extension:
 * You can use the setMessages() method to replace message content for multi-language support
 */

/**
 * Default message definitions
 */
const defaultMessages = {
  /** Protocol related errors */
  INVALID_PROTOCOL_VERSION_FORMAT: 'Invalid protocol version format',
  PROTOCOL_VERSION_TOO_LOW: 'Protocol version {0} is too low, minimum supported version is {1}',
  PROTOCOL_VERSION_UNSUPPORTED: 'Protocol Version Unsupported',
  
  /** Message format errors */
  INVALID_MESSAGE_FORMAT_NOT_OBJECT: 'Invalid message format: not an object',
  INVALID_MESSAGE_FORMAT_MISSING_PROTOCOL: 'Invalid message format: missing __requestIframe__ field',
  INVALID_MESSAGE_FORMAT_MISSING_TYPE: 'Invalid message format: missing or invalid type field',
  INVALID_MESSAGE_FORMAT_MISSING_REQUEST_ID: 'Invalid message format: missing or invalid requestId field',

  /** Timeout errors */
  ACK_TIMEOUT: 'ACK timeout after {0}ms',
  REQUEST_TIMEOUT: 'Request timeout after {0}ms',
  ASYNC_REQUEST_TIMEOUT: 'Async request timeout after {0}ms',

  /** Request/response errors */
  REQUEST_FAILED: 'Request failed',
  METHOD_NOT_FOUND: 'Method not found',
  NO_RESPONSE_SENT: 'Handler completed but no response sent',
  MIDDLEWARE_ERROR: 'Middleware error',
  ERROR: 'Error',

  /** Client errors */
  IFRAME_NOT_READY: 'iframe.contentWindow is not available',
  TARGET_WINDOW_CLOSED: 'Target window is closed or no longer available',

  /** ClientServer warnings */
  CLIENT_SERVER_IGNORED_MESSAGE_WHEN_CLOSED:
    'Ignored message because client server is closed/destroyed (type: {0}, requestId: {1})',

  /** Stream related messages */
  STREAM_NOT_BOUND: 'Stream is not bound to a request context',
  STREAM_ALREADY_STARTED: 'Stream has already started',
  STREAM_CANCELLED: 'Stream was cancelled: {0}',
  STREAM_ERROR: 'Stream error: {0}',
  STREAM_ENDED: 'Stream has ended',
  STREAM_READ_ERROR: 'Failed to read stream data',

  /** Debug messages - Client */
  DEBUG_CLIENT_REQUEST_START: '📤 [Client] Request Start',
  DEBUG_CLIENT_REQUEST_SUCCESS: '✅ [Client] Request Success',
  DEBUG_CLIENT_REQUEST_SUCCESS_FILE: '✅ [Client] Request Success (File)',
  DEBUG_CLIENT_REQUEST_SUCCESS_STREAM: '✅ [Client] Request Success (Stream)',
  DEBUG_CLIENT_REQUEST_FAILED: '❌ [Client] Request Failed',
  DEBUG_CLIENT_RECEIVED_ACK: '📥 [Client] Received ACK',
  DEBUG_CLIENT_RECEIVED_ASYNC: '⏳ [Client] Received ASYNC Notification',
  DEBUG_CLIENT_RECEIVED_STREAM_START: '🌊 [Client] Received Stream Start',
  DEBUG_CLIENT_RECEIVED_STREAM_DATA: '🌊 [Client] Received Stream Data',
  DEBUG_CLIENT_RECEIVED_STREAM_END: '🌊 [Client] Received Stream End',
  DEBUG_CLIENT_RECEIVED_RESPONSE: '📥 [Client] Received Response',
  DEBUG_CLIENT_RECEIVED_ERROR: '📥 [Client] Received Error',
  DEBUG_CLIENT_REQUEST_TIMEOUT: '⏱️ [Client] Request Timeout',
  DEBUG_CLIENT_SENDING_REQUEST: '📤 [Client] Sending Request',
  DEBUG_CLIENT_SENDING_PING: '📤 [Client] Sending Ping',
  DEBUG_CLIENT_SENDING_RECEIVED_ACK: '📤 [Client] Sending Received ACK',

  /** Debug messages - Server */
  DEBUG_SERVER_RECEIVED_REQUEST: '📥 [Server] Received Request',
  DEBUG_SERVER_SETTING_STATUS_CODE: '📝 [Server] Setting Status Code',
  DEBUG_SERVER_SETTING_HEADER: '📝 [Server] Setting Header',
  DEBUG_SERVER_SENDING_RESPONSE: '📤 [Server] Sending Response',
  DEBUG_SERVER_SENDING_JSON_RESPONSE: '📤 [Server] Sending JSON Response',
  DEBUG_SERVER_SENDING_FILE: '📤 [Server] Sending File',
  DEBUG_SERVER_SENDING_STREAM: '📤 [Server] Sending Stream',
  DEBUG_SERVER_SENDING_ACK: '📤 [Server] Sending ACK',
  DEBUG_SERVER_SENDING_ASYNC: '📤 [Server] Sending ASYNC Notification',
  DEBUG_SERVER_SENDING_STREAM_START: '🌊 [Server] Sending Stream Start',
  DEBUG_SERVER_SENDING_STREAM_DATA: '🌊 [Server] Sending Stream Data',
  DEBUG_SERVER_SENDING_STREAM_END: '🌊 [Server] Sending Stream End',
  DEBUG_SERVER_SENDING_ERROR: '📤 [Server] Sending Error',
  DEBUG_SERVER_SENDING_RESPONSE_VIA_DISPATCHER: '📤 [Server] Sending Response (via dispatcher)',
  DEBUG_SERVER_HANDLING_REQUEST: '📥 [Server] Handling Request',
  DEBUG_SERVER_EXECUTING_MIDDLEWARE_CHAIN: '⚙️ [Server] Executing Middleware Chain',
  DEBUG_SERVER_MIDDLEWARE_CHAIN_COMPLETED: '✅ [Server] Middleware Chain Completed'
} as const;

/**
 * Message type
 */
export type MessageKey = keyof typeof defaultMessages;

/**
 * Current message configuration
 */
let currentMessages: Record<MessageKey, string> = { ...defaultMessages };

/**
 * Message constants object
 */
export const Messages: Readonly<Record<MessageKey, string>> = new Proxy(currentMessages, {
  get(target, prop: string) {
    return target[prop as MessageKey] || prop;
  }
});

/**
 * Set message content (for multi-language support)
 * @param messages Custom message content (partial or full)
 */
export function setMessages(messages: Partial<Record<MessageKey, string>>): void {
  currentMessages = { ...defaultMessages, ...messages };
}

/**
 * Reset to default messages
 */
export function resetMessages(): void {
  currentMessages = { ...defaultMessages };
}

/**
 * Format message (replace placeholders)
 * @param template Message template, using {0}, {1}, etc. as placeholders
 * @param args Replacement parameters
 * @returns Formatted message
 * 
 * @example
 * formatMessage('Connect timeout after {0}ms', 5000)
 * // => 'Connect timeout after 5000ms'
 * 
 * formatMessage('Protocol version {0} is too low, minimum supported version is {1}', 0, 1)
 * // => 'Protocol version 0 is too low, minimum supported version is 1'
 */
export function formatMessage(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const argIndex = parseInt(index, 10);
    return argIndex < args.length ? String(args[argIndex]) : match;
  });
}

/**
 * Get current message configuration
 */
export function getMessages(): Readonly<Record<MessageKey, string>> {
  return { ...currentMessages };
}
