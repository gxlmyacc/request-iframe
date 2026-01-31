import { RequestConfig, Response, ErrorResponse, ServerRequest, ServerResponse, PostMessageData } from '../types';
import { RequestIframeClient, RequestIframeServer } from '../types';
import { MessageType, getStatusText, Messages } from '../constants';

/**
 * Debug log prefix
 */
const DEBUG_PREFIX = '[request-iframe]';

/**
 * Format log output
 * - Prefix: bold
 * - info: message text in blue
 */
function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `${DEBUG_PREFIX} [${timestamp}] [${level.toUpperCase()}]`;

  const prefixStyle = 'font-weight:bold';
  const messageStyle = level === 'info' ? 'color: #1976d2' : '';

  if (data !== undefined) {
    console[level](`%c${prefix}%c ${message}`, prefixStyle, messageStyle, data);
  } else {
    console[level](`%c${prefix}%c ${message}`, prefixStyle, messageStyle);
  }
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
  // Request interceptor: log request start
  client.interceptors.request.use((config: RequestConfig) => {
    log('info', Messages.DEBUG_CLIENT_REQUEST_START, formatMessageData({
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
        log('info', Messages.DEBUG_CLIENT_REQUEST_SUCCESS_FILE, formatMessageData(logData));
      } else if (response.stream) {
        logData.stream = {
          streamId: (response.stream as any).streamId,
          type: (response.stream as any).type
        };
        log('info', Messages.DEBUG_CLIENT_REQUEST_SUCCESS_STREAM, formatMessageData(logData));
      } else {
        logData.data = response.data;
        log('info', Messages.DEBUG_CLIENT_REQUEST_SUCCESS, formatMessageData(logData));
      }
      
      return response;
    },
    (error: ErrorResponse) => {
      log('error', Messages.DEBUG_CLIENT_REQUEST_FAILED, formatMessageData({
        requestId: error.requestId,
        code: error.code,
        message: error.message,
        config: error.config,
        response: error.response
      }));
      return Promise.reject(error);
    }
  );
  
  // Hook into client's internal message handling via server's message dispatcher
  // This requires accessing internal properties, so we use type assertion
  const clientImpl = client as any;
  if (clientImpl.server && clientImpl.server.messageDispatcher) {
    setupClientMessageDebugging(clientImpl);
  }
}

/**
 * Setup message-level debugging for client
 */
function setupClientMessageDebugging(clientImpl: any): void {
  const server = clientImpl.server;
  
  // Store original _registerPendingRequest
  const originalRegister = server._registerPendingRequest?.bind(server);
  if (originalRegister) {
    server._registerPendingRequest = function(
      requestId: string,
      resolve: (data: PostMessageData) => void,
      reject: () => void,
      origin?: string
    ) {
      // Wrap resolve to log incoming messages
      const wrappedResolve = (data: PostMessageData) => {
        if (data.type === MessageType.ACK) {
          log('info', Messages.DEBUG_CLIENT_RECEIVED_ACK, formatMessageData({
            requestId: data.requestId,
            path: data.path
          }));
        } else if (data.type === MessageType.ASYNC) {
          log('info', Messages.DEBUG_CLIENT_RECEIVED_ASYNC, formatMessageData({
            requestId: data.requestId,
            path: data.path
          }));
        } else if (data.type === MessageType.STREAM_START) {
          const streamBody = data.body as any;
          log('info', Messages.DEBUG_CLIENT_RECEIVED_STREAM_START, formatMessageData({
            requestId: data.requestId,
            streamId: streamBody?.streamId,
            streamType: streamBody?.type,
            chunked: streamBody?.chunked,
            autoResolve: streamBody?.autoResolve,
            metadata: streamBody?.metadata
          }));
        } else if (data.type === MessageType.STREAM_DATA) {
          const streamBody = data.body as any;
          log('info', Messages.DEBUG_CLIENT_RECEIVED_STREAM_DATA, formatMessageData({
            requestId: data.requestId,
            streamId: streamBody?.streamId,
            done: streamBody?.done,
            dataLength: streamBody?.data?.length || 0
          }));
        } else if (data.type === MessageType.STREAM_END) {
          const streamBody = data.body as any;
          log('info', Messages.DEBUG_CLIENT_RECEIVED_STREAM_END, formatMessageData({
            requestId: data.requestId,
            streamId: streamBody?.streamId
          }));
        } else if (data.type === MessageType.RESPONSE) {
          log('info', Messages.DEBUG_CLIENT_RECEIVED_RESPONSE, formatMessageData({
            requestId: data.requestId,
            status: data.status,
            statusText: data.statusText,
            requireAck: data.requireAck
          }));
        } else if (data.type === MessageType.ERROR) {
          log('error', Messages.DEBUG_CLIENT_RECEIVED_ERROR, formatMessageData({
            requestId: data.requestId,
            status: data.status,
            statusText: data.statusText,
            error: data.error
          }));
        }
        
        resolve(data);
      };
      
      // Wrap reject to log timeouts
      const wrappedReject = () => {
        log('warn', Messages.DEBUG_CLIENT_REQUEST_TIMEOUT, { requestId, origin });
        reject();
      };
      
      return originalRegister(requestId, wrappedResolve, wrappedReject, origin);
    };
  }
  
  // Log when messages are sent
  const originalSendMessage = server.messageDispatcher?.sendMessage?.bind(server.messageDispatcher);
  if (originalSendMessage) {
    server.messageDispatcher.sendMessage = function(
      target: Window,
      targetOrigin: string,
      type: string,
      requestId: string,
      data?: any
    ) {
      if (type === MessageType.REQUEST) {
        log('info', Messages.DEBUG_CLIENT_SENDING_REQUEST, formatMessageData({
          requestId,
          path: data?.path,
          body: data?.body,
          headers: data?.headers
        }));
      } else if (type === MessageType.PING) {
        log('info', Messages.DEBUG_CLIENT_SENDING_PING, { requestId });
      } else if (type === MessageType.ACK) {
        log('info', Messages.DEBUG_CLIENT_SENDING_RECEIVED_ACK, { requestId });
      }
      
      return originalSendMessage(target, targetOrigin, type, requestId, data);
    };
  }
}

/**
 * Register debug listeners for server
 * Use middleware to log requests and responses
 */
export function setupServerDebugListeners(server: RequestIframeServer): void {
  const serverImpl = server as any;
  const startTimes = new Map<string, number>();
  
  // Use global middleware to log requests
  server.use((req: ServerRequest, res: ServerResponse, next: () => void) => {
    const startTime = Date.now();
    startTimes.set(req.requestId, startTime);
    
    log('info', Messages.DEBUG_SERVER_RECEIVED_REQUEST, formatMessageData({
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
      log('info', Messages.DEBUG_SERVER_SETTING_STATUS_CODE, {
        requestId: req.requestId,
        path: req.path,
        statusCode: code
      });
      return originalStatus(code);
    };

    // Track header changes
    res.setHeader = function(name: string, value: string | number | string[]): void {
      log('info', Messages.DEBUG_SERVER_SETTING_HEADER, {
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
      
      log('info', Messages.DEBUG_SERVER_SENDING_RESPONSE, formatMessageData({
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
      
      log('info', Messages.DEBUG_SERVER_SENDING_JSON_RESPONSE, formatMessageData({
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
      
      log('info', Messages.DEBUG_SERVER_SENDING_FILE, formatMessageData({
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
        
        log('info', Messages.DEBUG_SERVER_SENDING_STREAM, formatMessageData({
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
  
  // Hook into server's message dispatcher for more detailed logging
  if (serverImpl.messageDispatcher) {
    setupServerMessageDebugging(serverImpl);
  }
}

/**
 * Setup message-level debugging for server
 */
function setupServerMessageDebugging(serverImpl: any): void {
  const dispatcher = serverImpl.messageDispatcher;
  
  // Log when messages are sent
  const originalSendMessage = dispatcher.sendMessage?.bind(dispatcher);
  if (originalSendMessage) {
    dispatcher.sendMessage = function(
      target: Window,
      targetOrigin: string,
      type: string,
      requestId: string,
      data?: any
    ) {
      if (type === MessageType.ACK) {
        log('info', Messages.DEBUG_SERVER_SENDING_ACK, formatMessageData({
          requestId,
          path: data?.path
        }));
      } else if (type === MessageType.ASYNC) {
        log('info', Messages.DEBUG_SERVER_SENDING_ASYNC, formatMessageData({
          requestId,
          path: data?.path
        }));
      } else if (type === MessageType.STREAM_START) {
        const streamBody = data?.body || {};
        log('info', Messages.DEBUG_SERVER_SENDING_STREAM_START, formatMessageData({
          requestId,
          streamId: streamBody.streamId,
          streamType: streamBody.type,
          chunked: streamBody.chunked,
          autoResolve: streamBody.autoResolve,
          metadata: streamBody.metadata
        }));
      } else if (type === MessageType.STREAM_DATA) {
        const streamBody = data?.body || {};
        log('info', Messages.DEBUG_SERVER_SENDING_STREAM_DATA, formatMessageData({
          requestId,
          streamId: streamBody.streamId,
          done: streamBody.done,
          dataLength: streamBody.data?.length || 0
        }));
      } else if (type === MessageType.STREAM_END) {
        const streamBody = data?.body || {};
        log('info', Messages.DEBUG_SERVER_SENDING_STREAM_END, formatMessageData({
          requestId,
          streamId: streamBody.streamId
        }));
      } else if (type === MessageType.ERROR) {
        log('error', Messages.DEBUG_SERVER_SENDING_ERROR, formatMessageData({
          requestId,
          status: data?.status,
          statusText: data?.statusText,
          error: data?.error,
          path: data?.path
        }));
      } else if (type === MessageType.RESPONSE) {
        log('info', Messages.DEBUG_SERVER_SENDING_RESPONSE_VIA_DISPATCHER, formatMessageData({
          requestId,
          status: data?.status,
          statusText: data?.statusText,
          requireAck: data?.requireAck,
          path: data?.path
        }));
      }
      
      return originalSendMessage(target, targetOrigin, type, requestId, data);
    };
  }
  
  // Log when requests are received (before handler)
  const originalHandleRequest = serverImpl.handleRequest?.bind(serverImpl);
  if (originalHandleRequest) {
    serverImpl.handleRequest = function(data: PostMessageData, context: any) {
      log('info', Messages.DEBUG_SERVER_HANDLING_REQUEST, formatMessageData({
        requestId: data.requestId,
        path: data.path,
        origin: context?.origin,
        role: data.role,
        creatorId: data.creatorId
      }));
      return originalHandleRequest(data, context);
    };
  }
  
  // Log handler execution
  const originalRunMiddlewares = serverImpl.runMiddlewares?.bind(serverImpl);
  if (originalRunMiddlewares) {
    serverImpl.runMiddlewares = function(req: ServerRequest, res: ServerResponse, callback: () => void) {
      const handlerStartTime = Date.now();
      log('info', Messages.DEBUG_SERVER_EXECUTING_MIDDLEWARE_CHAIN, {
        requestId: req.requestId,
        path: req.path
      });
      
      return originalRunMiddlewares(req, res, () => {
        const handlerDuration = Date.now() - handlerStartTime;
        log('info', Messages.DEBUG_SERVER_MIDDLEWARE_CHAIN_COMPLETED, {
          requestId: req.requestId,
          path: req.path,
          duration: `${handlerDuration}ms`
        });
        callback();
      });
    };
  }
}
