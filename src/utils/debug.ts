import { RequestConfig, Response, ErrorResponse, ServerRequest, ServerResponse, PostMessageData } from '../types';
import { RequestIframeClient, RequestIframeServer } from '../types';
import { MessageType, getStatusText, Messages, LogLevel, DebugEvent, DebugEventValue } from '../constants';
import { ensureRequestIframeLogLevel, requestIframeLog } from './logger';

type DebugLogLevel = typeof LogLevel.INFO | typeof LogLevel.WARN | typeof LogLevel.ERROR;

function logEvent(level: DebugLogLevel, event: DebugEventValue, message: string, data?: unknown): void {
  if (data !== undefined && data !== null && typeof data === 'object') {
    requestIframeLog(level, message, { event, ...(data as any) });
    return;
  }
  requestIframeLog(level, message, data === undefined ? { event } : { event, data });
}

/**
 * Format message data for logging (remove sensitive data if needed)
 */
function formatMessageData(data: any): any {
  if (!data) return data;
  
  const formatted = { ...data };
  
  // Limit body size in logs
  if (formatted.body && typeof formatted.body === 'object') {
    const bodyStr = JSON.stringify(formatted.body);
    if (bodyStr.length > 500) {
      formatted.body = bodyStr.substring(0, 500) + '... (truncated)';
    }
  }
  
  // Limit data size in logs
  if (formatted.data && typeof formatted.data === 'object') {
    const dataStr = JSON.stringify(formatted.data);
    if (dataStr.length > 500) {
      formatted.data = dataStr.substring(0, 500) + '... (truncated)';
    }
  }
  
  return formatted;
}

/**
 * Register debug interceptors for client
 */
export function setupClientDebugInterceptors(client: RequestIframeClient): void {
  ensureRequestIframeLogLevel(LogLevel.INFO);

  // Request interceptor: log request start
  client.interceptors.request.use((config: RequestConfig) => {
    logEvent(LogLevel.INFO, DebugEvent.CLIENT_REQUEST_START, Messages.DEBUG_CLIENT_REQUEST_START, formatMessageData({
      path: config.path,
      body: config.body,
      headers: config.headers,
      cookies: config.cookies,
      ackTimeout: config.ackTimeout,
      timeout: config.timeout,
      asyncTimeout: config.asyncTimeout,
      requestId: config.requestId
    }));
    return config;
  });

  // Response interceptor: log response success
  client.interceptors.response.use(
    (response: Response) => {
      const logData: any = {
        requestId: response.requestId,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      };
      
      // Check if response.data is a File or Blob
      if (response.data instanceof File || response.data instanceof Blob) {
        const file = response.data;
        const fileName = file instanceof File ? file.name : undefined;
        const mimeType = file.type || undefined;
        const contentLength = file.size;
        
        logData.fileData = {
          fileName,
          mimeType,
          contentLength
        };
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_REQUEST_SUCCESS_FILE, Messages.DEBUG_CLIENT_REQUEST_SUCCESS_FILE, formatMessageData(logData));
      } else if (response.stream) {
        logData.stream = {
          streamId: (response.stream as any).streamId,
          type: (response.stream as any).type
        };
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_REQUEST_SUCCESS_STREAM, Messages.DEBUG_CLIENT_REQUEST_SUCCESS_STREAM, formatMessageData(logData));
      } else {
        logData.data = response.data;
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_REQUEST_SUCCESS, Messages.DEBUG_CLIENT_REQUEST_SUCCESS, formatMessageData(logData));
      }
      
      return response;
    },
    (error: ErrorResponse) => {
      logEvent(LogLevel.ERROR, DebugEvent.CLIENT_REQUEST_FAILED, Messages.DEBUG_CLIENT_REQUEST_FAILED, formatMessageData({
        requestId: error.requestId,
        code: error.code,
        message: error.message,
        config: error.config,
        response: error.response
      }));
      return Promise.reject(error);
    }
  );
  
  /** Attach hook-based message debugging (no monkey patch). */
  const clientImpl = client as any;
  setupClientMessageDebuggingViaHooks(clientImpl);
}

/**
 * Setup message-level debugging for client (hook-based, no monkey patch).
 */
function setupClientMessageDebuggingViaHooks(clientImpl: any): void {
  const inbox = clientImpl.inbox;
  const outbox = clientImpl.outbox;
  const dispatcher = clientImpl.hub?.messageDispatcher || clientImpl.getHub?.()?.messageDispatcher;

  /** Outbound */
  if (outbox?.hooks?.afterSendMessage?.tap) {
    outbox.hooks.afterSendMessage.tap('debug', (type: string, requestId: string, data: any) => {
      if (type === MessageType.REQUEST) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_OUTBOUND, Messages.DEBUG_CLIENT_SENDING_REQUEST, formatMessageData({
          requestId,
          path: data?.path,
          body: data?.body,
          headers: data?.headers
        }));
      } else if (type === MessageType.PING) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_OUTBOUND, Messages.DEBUG_CLIENT_SENDING_PING, { requestId });
      } else if (type === MessageType.ACK) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_OUTBOUND, Messages.DEBUG_CLIENT_SENDING_RECEIVED_ACK, { requestId });
      }
    });
  } else if (dispatcher?.hooks?.afterSend?.tap) {
    dispatcher.hooks.afterSend.tap('debug', (_target: any, _origin: string, message: PostMessageData) => {
      if (message.type === MessageType.REQUEST) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_OUTBOUND, Messages.DEBUG_CLIENT_SENDING_REQUEST, formatMessageData({
          requestId: message.requestId,
          path: message.path,
          body: message.body,
          headers: message.headers
        }));
      }
    });
  }

  /** Inbound */
  if (inbox?.hooks?.inbound?.tap) {
    inbox.hooks.inbound.tap('debug', (data: PostMessageData) => {
      if (data.type === MessageType.ACK) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_ACK, formatMessageData({ requestId: data.requestId, path: data.path }));
      } else if (data.type === MessageType.ASYNC) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_ASYNC, formatMessageData({ requestId: data.requestId, path: data.path }));
      } else if (data.type === MessageType.STREAM_START) {
        const streamBody = data.body as any;
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_STREAM_START, formatMessageData({
          requestId: data.requestId,
          streamId: streamBody?.streamId,
          streamType: streamBody?.type,
          chunked: streamBody?.chunked,
          autoResolve: streamBody?.autoResolve,
          metadata: streamBody?.metadata
        }));
      } else if (data.type === MessageType.STREAM_DATA) {
        const streamBody = data.body as any;
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_STREAM_DATA, formatMessageData({
          requestId: data.requestId,
          streamId: streamBody?.streamId,
          done: streamBody?.done,
          dataLength: streamBody?.data?.length || 0
        }));
      } else if (data.type === MessageType.STREAM_END) {
        const streamBody = data.body as any;
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_STREAM_END, formatMessageData({
          requestId: data.requestId,
          streamId: streamBody?.streamId
        }));
      } else if (data.type === MessageType.RESPONSE) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_RESPONSE, formatMessageData({
          requestId: data.requestId,
          status: data.status,
          statusText: data.statusText,
          requireAck: data.requireAck
        }));
      } else if (data.type === MessageType.ERROR) {
        logEvent(LogLevel.ERROR, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_ERROR, formatMessageData({
          requestId: data.requestId,
          status: data.status,
          statusText: data.statusText,
          error: data.error
        }));
      }
    });
  } else if (dispatcher?.hooks?.inbound?.tap) {
    dispatcher.hooks.inbound.tap('debug', (data: PostMessageData) => {
      if (data.type === MessageType.ACK) {
        logEvent(LogLevel.INFO, DebugEvent.CLIENT_MESSAGE_INBOUND, Messages.DEBUG_CLIENT_RECEIVED_ACK, formatMessageData({ requestId: data.requestId, path: data.path }));
      }
    });
  }
}

/**
 * Register debug listeners for server
 * Use middleware to log requests and responses
 */
export function setupServerDebugListeners(server: RequestIframeServer): void {
  ensureRequestIframeLogLevel(LogLevel.INFO);

  const serverImpl = server as any;
  const startTimes = new Map<string, number>();
  
  // Use global middleware to log requests
  server.use((req: ServerRequest, res: ServerResponse, next: () => void) => {
    const startTime = Date.now();
    startTimes.set(req.requestId, startTime);
    
    logEvent(LogLevel.INFO, DebugEvent.SERVER_REQUEST_RECEIVED, Messages.DEBUG_SERVER_RECEIVED_REQUEST, formatMessageData({
      requestId: req.requestId,
      path: req.path,
      body: req.body,
      origin: req.origin,
      headers: req.headers,
      cookies: req.cookies,
      method: 'POST' // iframe requests are always POST-like
    }));

    // Store original send methods
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalSendFile = res.sendFile.bind(res);
    const originalSendStream = res.sendStream?.bind(res);
    const originalStatus = res.status.bind(res);
    const originalSetHeader = res.setHeader.bind(res);

    // Track status code changes
    res.status = function(code: number): ServerResponse {
      logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SETTING_STATUS_CODE, {
        requestId: req.requestId,
        path: req.path,
        statusCode: code
      });
      return originalStatus(code);
    };

    // Track header changes
    res.setHeader = function(name: string, value: string | number | string[]): void {
      logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SETTING_HEADER, {
        requestId: req.requestId,
        path: req.path,
        header: name,
        value: Array.isArray(value) ? value.join(', ') : String(value)
      });
      return originalSetHeader(name, value);
    };

    // Override send method
    res.send = async function(data: any, options?: any): Promise<boolean> {
      const duration = Date.now() - (startTimes.get(req.requestId) || startTime);
      startTimes.delete(req.requestId);
      
      logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SENDING_RESPONSE, formatMessageData({
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        statusText: getStatusText(res.statusCode),
        requireAck: options?.requireAck,
        headers: res.headers,
        data,
        duration: `${duration}ms`
      }));
      return originalSend(data, options);
    };

    // Override json method
    res.json = async function(data: any, options?: any): Promise<boolean> {
      const duration = Date.now() - (startTimes.get(req.requestId) || startTime);
      startTimes.delete(req.requestId);
      
      logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SENDING_JSON_RESPONSE, formatMessageData({
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        statusText: getStatusText(res.statusCode),
        requireAck: options?.requireAck,
        headers: res.headers,
        data,
        duration: `${duration}ms`
      }));
      return originalJson(data, options);
    };

    // Override sendFile method
    res.sendFile = async function(content: any, options?: any): Promise<boolean> {
      const duration = Date.now() - (startTimes.get(req.requestId) || startTime);
      startTimes.delete(req.requestId);
      
      logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SENDING_FILE, formatMessageData({
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        statusText: getStatusText(res.statusCode),
        fileName: options?.fileName,
        mimeType: options?.mimeType,
        contentLength: typeof content === 'string' ? content.length : content?.size || 0,
        duration: `${duration}ms`
      }));
      return originalSendFile(content, options);
    };

    // Override sendStream method if exists
    if (originalSendStream) {
      res.sendStream = async function(stream: any): Promise<void> {
        const duration = Date.now() - (startTimes.get(req.requestId) || startTime);
        startTimes.delete(req.requestId);
        
        logEvent(LogLevel.INFO, DebugEvent.SERVER_RESPONSE_SEND, Messages.DEBUG_SERVER_SENDING_STREAM, formatMessageData({
          requestId: req.requestId,
          path: req.path,
          status: res.statusCode,
          statusText: getStatusText(res.statusCode),
          streamId: stream?.streamId,
          duration: `${duration}ms`
        }));
        return originalSendStream(stream);
      };
    }

    next();
  });
  
  /** Hook into MessageDispatcher hooks (no monkey patch). */
  setupServerMessageDebuggingViaHooks(serverImpl);
}

/**
 * Setup message-level debugging for server (hook-based, no monkey patch).
 */
function setupServerMessageDebuggingViaHooks(serverImpl: any): void {
  const dispatcher = serverImpl.messageDispatcher || serverImpl.dispatcher;
  if (!dispatcher?.hooks) return;

  /** Outbound messages */
  if (dispatcher.hooks.afterSend?.tap) {
    dispatcher.hooks.afterSend.tap('debug', (_target: any, _targetOrigin: string, message: PostMessageData) => {
      const type = message.type as string;
      const requestId = message.requestId;
      const data: any = message;

      if (type === MessageType.ACK) {
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_ACK, formatMessageData({ requestId, path: (data as any).path }));
      } else if (type === MessageType.ASYNC) {
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_ASYNC, formatMessageData({ requestId, path: (data as any).path }));
      } else if (type === MessageType.STREAM_START) {
        const streamBody = (data as any)?.body || {};
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_STREAM_START, formatMessageData({
          requestId,
          streamId: streamBody.streamId,
          streamType: streamBody.type,
          chunked: streamBody.chunked,
          autoResolve: streamBody.autoResolve,
          metadata: streamBody.metadata
        }));
      } else if (type === MessageType.STREAM_DATA) {
        const streamBody = (data as any)?.body || {};
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_STREAM_DATA, formatMessageData({
          requestId,
          streamId: streamBody.streamId,
          done: streamBody.done,
          dataLength: streamBody.data?.length || 0
        }));
      } else if (type === MessageType.STREAM_END) {
        const streamBody = (data as any)?.body || {};
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_STREAM_END, formatMessageData({
          requestId,
          streamId: streamBody.streamId
        }));
      } else if (type === MessageType.ERROR) {
        logEvent(LogLevel.ERROR, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_ERROR, formatMessageData({
          requestId,
          status: (data as any)?.status,
          statusText: (data as any)?.statusText,
          error: (data as any)?.error,
          path: (data as any)?.path
        }));
      } else if (type === MessageType.RESPONSE) {
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_OUTBOUND, Messages.DEBUG_SERVER_SENDING_RESPONSE_VIA_DISPATCHER, formatMessageData({
          requestId,
          status: (data as any)?.status,
          statusText: (data as any)?.statusText,
          requireAck: (data as any)?.requireAck,
          path: (data as any)?.path
        }));
      }
    });
  }

  /** Inbound messages */
  if (dispatcher.hooks.inbound?.tap) {
    dispatcher.hooks.inbound.tap('debug', (data: PostMessageData, context: any) => {
      if (data.type === MessageType.REQUEST) {
        logEvent(LogLevel.INFO, DebugEvent.SERVER_MESSAGE_INBOUND, Messages.DEBUG_SERVER_HANDLING_REQUEST, formatMessageData({
          requestId: data.requestId,
          path: data.path,
          origin: context?.origin,
          role: data.role,
          creatorId: data.creatorId
        }));
      }
    });
  }
}
