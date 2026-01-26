import { RequestConfig, Response, ErrorResponse, ServerRequest, ServerResponse } from '../types';
import { RequestIframeClient, RequestIframeServer } from '../types';

/**
 * Debug log prefix
 */
const DEBUG_PREFIX = '[request-iframe]';

/**
 * Format log output
 */
function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `${DEBUG_PREFIX} [${timestamp}] [${level.toUpperCase()}]`;
  
  if (data !== undefined) {
    console[level](`${prefix} ${message}`, data);
  } else {
    console[level](`${prefix} ${message}`);
  }
}

/**
 * Register debug interceptors for client
 */
export function setupClientDebugInterceptors(client: RequestIframeClient): void {
  // Request interceptor: log request start
  client.interceptors.request.use((config: RequestConfig) => {
    log('info', '📤 Request Start', {
      path: config.path,
      body: config.body,
      ackTimeout: config.ackTimeout,
      timeout: config.timeout,
      asyncTimeout: config.asyncTimeout,
      requestId: config.requestId
    });
    return config;
  });

  // Response interceptor: log response success
  client.interceptors.response.use(
    (response: Response) => {
      log('info', '✅ Request Success', {
        requestId: response.requestId,
        status: response.status,
        statusText: response.statusText,
        data: response.data
      });
      return response;
    },
    (error: ErrorResponse) => {
      log('error', '❌ Request Failed', {
        requestId: error.requestId,
        code: error.code,
        message: error.message,
        response: error.response
      });
      return Promise.reject(error);
    }
  );
}

/**
 * Register debug listeners for server
 * Use middleware to log requests and responses
 */
export function setupServerDebugListeners(server: RequestIframeServer): void {
  // Use global middleware to log requests
  server.use((req: ServerRequest, res: ServerResponse, next: () => void) => {
    log('info', '📥 Server Received Request', {
      requestId: req.requestId,
      path: req.path,
      body: req.body,
      origin: req.origin,
      headers: req.headers,
      cookies: req.cookies
    });

    // Store original send methods
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalSendFile = res.sendFile.bind(res);

    // Override send method
    res.send = async function(data: any, options?: any): Promise<boolean> {
      log('info', '📤 Server Sending Response', {
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        data
      });
      return originalSend(data, options);
    };

    // Override json method
    res.json = async function(data: any, options?: any): Promise<boolean> {
      log('info', '📤 Server Sending JSON Response', {
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        data
      });
      return originalJson(data, options);
    };

    // Override sendFile method
    res.sendFile = async function(content: any, options?: any): Promise<boolean> {
      log('info', '📤 Server Sending File', {
        requestId: req.requestId,
        path: req.path,
        status: res.statusCode,
        fileName: options?.fileName,
        mimeType: options?.mimeType
      });
      return originalSendFile(content, options);
    };

    next();
  });
}
