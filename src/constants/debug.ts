/**
 * Debug constants (event names for structured logs).
 */

export const DebugEvent = {
  CLIENT_REQUEST_START: 'client.request.start',
  CLIENT_REQUEST_SUCCESS: 'client.request.success',
  CLIENT_REQUEST_SUCCESS_FILE: 'client.request.success.file',
  CLIENT_REQUEST_SUCCESS_STREAM: 'client.request.success.stream',
  CLIENT_REQUEST_FAILED: 'client.request.failed',
  CLIENT_MESSAGE_INBOUND: 'client.message.inbound',
  CLIENT_MESSAGE_OUTBOUND: 'client.message.outbound',
  SERVER_REQUEST_RECEIVED: 'server.request.received',
  SERVER_RESPONSE_SEND: 'server.response.send',
  SERVER_MESSAGE_INBOUND: 'server.message.inbound',
  SERVER_MESSAGE_OUTBOUND: 'server.message.outbound'
} as const;

export type DebugEventValue = typeof DebugEvent[keyof typeof DebugEvent];

