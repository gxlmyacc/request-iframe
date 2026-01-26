/**
 * Request default configuration
 * Can be set when creating requestIframeClient, and can be overridden on each request
 */
export interface RequestDefaults {
  /** ACK confirmation timeout (milliseconds), timeout for waiting for the other party to acknowledge the message, default 500 */
  ackTimeout?: number;
  /** Request timeout (milliseconds), timeout for waiting for the server to return the result, default 5000 */
  timeout?: number;
  /** Async request timeout (milliseconds), timeout after the server indicates it's an async task, default 120000 */
  asyncTimeout?: number;
}

/**
 * sender.send configuration options
 */
export interface RequestOptions extends RequestDefaults {
  /** Custom request ID */
  requestId?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request cookies */
  cookies?: Record<string, string>;
}

/**
 * sender.send request configuration (internal use)
 */
export interface RequestConfig extends RequestOptions {
  /** Interaction event ID (equivalent to path) */
  path: string;
  /** Request body */
  body?: Record<string, any>;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request cookies */
  cookies?: Record<string, string>;
}

/**
 * Response data
 */
export interface Response<T = any> {
  /** Response data */
  data: T;
  /** Status code */
  status: number;
  /** Status text */
  statusText: string;
  /** Request ID */
  requestId: string;
  /** Response headers (Set-Cookie is a string array) */
  headers?: Record<string, string | string[]>;
  /** File data (if response is a file) */
  fileData?: {
    content: string; // base64 encoded content
    mimeType?: string;
    fileName?: string;
  };
  /** Stream data (if response is a stream) */
  stream?: import('../stream').IIframeReadableStream<T>;
}

/**
 * Error response
 */
export interface ErrorResponse {
  /** Error message */
  message: string;
  /** Error code */
  code?: string;
  /** Request configuration */
  config?: RequestConfig;
  /** Response data (if available) */
  response?: {
    data: any;
    status: number;
    statusText: string;
  };
  /** Request ID */
  requestId?: string;
}

/**
 * Interceptor function type
 */
export type InterceptorFunction<T> = (value: T) => T | Promise<T>;

/**
 * Request interceptor
 */
export interface RequestInterceptor {
  fulfilled: InterceptorFunction<RequestConfig>;
  rejected?: (error: any) => any;
}

/**
 * Response interceptor
 */
export interface ResponseInterceptor {
  fulfilled: InterceptorFunction<Response>;
  rejected?: (error: ErrorResponse) => any;
}

/**
 * PostMessage message format
 * 
 * @description
 * The __requestIframe__ field is the protocol version identifier, used to:
 * - Distinguish request-iframe framework messages from other messages
 * - Support compatibility handling for future version upgrades
 * 
 * Version evolution rules:
 * - Minor updates (e.g., adding optional fields): keep version number unchanged
 * - Major updates (e.g., changing core field structure): increment version number
 */
export interface PostMessageData {
  /** 
   * Protocol version identifier
   * - Used to identify request-iframe framework messages
   * - The value represents the protocol version number, current version is 1
   * - Future version upgrades can use this field for compatibility handling
   */
  __requestIframe__: number;
  /** 
   * Message creation timestamp (milliseconds)
   * - Used for debugging and analyzing message latency
   * - Automatically added when each message is sent
   */
  timestamp: number;
  /** Message isolation key (used to isolate different businesses/instances) */
  secretKey?: string;
  /** Message type */
  type: 'request' | 'ack' | 'async' | 'response' | 'error' | 'received' | 'ping' | 'pong' | 
        'stream_start' | 'stream_data' | 'stream_end' | 'stream_error' | 'stream_cancel';
  /** Request ID */
  requestId: string;
  /** Request path */
  path?: string;
  /** Request body */
  body?: any;
  /** 
   * Headers
   * - On request: request headers
   * - On response: response headers (Set-Cookie is a string array)
   */
  headers?: Record<string, string | string[]>;
  /** 
   * Cookies (only used for requests)
   * - On request: request cookies (auto-carried by client + manually passed by user)
   * - On response: no longer used, use headers['Set-Cookie'] instead
   */
  cookies?: Record<string, string>;
  /** Response data */
  data?: any;
  /** File data (base64 encoded, used for sendFile) */
  fileData?: {
    content: string; // base64 encoded content
    mimeType?: string;
    fileName?: string;
  };
  /** Error information */
  error?: {
    message: string;
    code?: string;
  };
  /** Status code */
  status?: number;
  /** Status text */
  statusText?: string;
  /** Whether client confirmation of receipt is required (for response/error messages) */
  requireAck?: boolean;
}

/**
 * Server Request object (similar to express)
 */
export interface ServerRequest {
  /** Request body */
  body: any;
  /** Request headers */
  headers: Record<string, string>;
  /** Request cookies */
  cookies: Record<string, string>;
  /** Request path */
  path: string;
  /** Request ID */
  requestId: string;
  /** Sender origin */
  origin: string;
  /** Sender window reference */
  source: Window;
  /** Response object reference (consistent with Express) */
  res: ServerResponse;
}

/**
 * Send response options
 */
export interface SendOptions {
  /**
   * Whether client confirmation of receipt is required
   * - If true, the Promise returned by send/json/sendFile will resolve after the client confirms receipt
   * - If false (default), resolves immediately without waiting for client confirmation
   */
  requireAck?: boolean;
}

/**
 * Send file options
 */
export interface SendFileOptions extends SendOptions {
  /** File MIME type */
  mimeType?: string;
  /** File name */
  fileName?: string;
}

/**
 * Cookie options (consistent with Express)
 */
export interface CookieOptions {
  /** Cookie expiration time */
  expires?: Date;
  /** Cookie maximum age (seconds) */
  maxAge?: number;
  /** Cookie domain */
  domain?: string;
  /** Cookie path */
  path?: string;
  /** Whether to send only over HTTPS connections */
  secure?: boolean;
  /** Whether to forbid JavaScript access */
  httpOnly?: boolean;
  /** Cookie SameSite attribute */
  sameSite?: boolean | 'lax' | 'strict' | 'none';
}

/**
 * Server Response object (similar to express)
 */
export interface ServerResponse {
  /**
   * Send response data
   * @param data Response data
   * @param options Send options
   * @returns Promise<boolean> - If requireAck is true, resolves after client confirms receipt; otherwise resolves immediately
   */
  send(data: any, options?: SendOptions): Promise<boolean>;
  /**
   * Send JSON response
   * @param data JSON data
   * @param options Send options
   * @returns Promise<boolean> - If requireAck is true, resolves after client confirms receipt; otherwise resolves immediately
   */
  json(data: any, options?: SendOptions): Promise<boolean>;
  /**
   * Send file (base64 encoded)
   * @param content File content
   * @param options Send options (includes mimeType, fileName, requireAck)
   * @returns Promise<boolean> - If requireAck is true, resolves after client confirms receipt; otherwise resolves immediately
   */
  sendFile(content: string | Blob | File, options?: SendFileOptions): Promise<boolean>;
  /**
   * Send stream response
   * @param stream Writable stream object
   * @returns Promise<void> - Resolves after stream transfer completes
   */
  sendStream(stream: import('../stream').IframeWritableStream): Promise<void>;
  /** Set response status code (chainable) */
  status(code: number): ServerResponse;
  /** Set response header (consistent with Express, returns void) */
  setHeader(name: string, value: string | number | string[]): void;
  /** Set response header (chainable version, compatible with Express res.set) */
  set(name: string, value: string | number | string[]): ServerResponse;
  /** Set response cookie (consistent with Express, uses cookie method) */
  cookie(name: string, value: string, options?: CookieOptions): ServerResponse;
  /** Clear cookie (consistent with Express) */
  clearCookie(name: string, options?: CookieOptions): ServerResponse;
  /** Current status code */
  statusCode: number;
  /** Response headers (Set-Cookie is a string array) */
  headers: Record<string, string | string[]>;
  /** Internal property: whether response has been sent */
  _sent?: boolean;
}

/**
 * Path matcher type (supports string, RegExp, PathPattern, Array)
 */
export type PathMatcher = string | RegExp | Array<string | RegExp>;

/**
 * Middleware function type
 */
export type Middleware = (
  req: ServerRequest,
  res: ServerResponse,
  next: () => void | Promise<void>
) => void | Promise<void>;

/**
 * Server handler function (similar to express)
 */
export type ServerHandler = (
  req: ServerRequest,
  res: ServerResponse
) => any | Promise<any>;

/**
 * server.on/off event names (low-level)
 */
export type ServerEventName = 'request' | 'ack' | 'async' | 'response' | 'error' | 'received' | 'ping' | 'pong';

/**
 * Client interface
 */
export interface RequestIframeClient {
  /** Interceptors (only effective for send) */
  interceptors: {
    request: import('../interceptors').RequestInterceptorManager;
    response: import('../interceptors').ResponseInterceptorManager;
  };
  /** Send request */
  send<T = any>(
    path: string,
    body?: Record<string, any>,
    options?: RequestOptions
  ): Promise<Response<T>>;
  /** Check if server is reachable */
  isConnect(): Promise<boolean>;
  /** 
   * Get all cookies matching the specified path
   * @param path Request path, returns all cookies if not provided
   */
  getCookies(path?: string): Record<string, string>;
  /** 
   * Get specified cookie
   * @param name Cookie name
   * @param path Path (optional)
   */
  getCookie(name: string, path?: string): string | undefined;
  /** 
   * Set cookie
   * @param name Cookie name
   * @param value Cookie value
   * @param options Cookie options (path, etc.)
   */
  setCookie(name: string, value: string, options?: { path?: string; expires?: Date; maxAge?: number }): void;
  /** 
   * Delete specified cookie
   * @param name Cookie name
   * @param path Path (optional, defaults to '/')
   */
  removeCookie(name: string, path?: string): void;
  /** 
   * Clear all cookies
   */
  clearCookies(): void;
}

/**
 * Client server interface (used on client side, handles responses only)
 */
export interface RequestIframeClientServer {
  /** Destroy server (remove message listener) */
  destroy(): void;
  /** Internal method: listen to low-level events */
  _on(event: ServerEventName, fn: (payload: any) => void): void;
  /** Internal method: unsubscribe from low-level events */
  _off(event: ServerEventName, fn?: (payload: any) => void): void;
  /** Internal method: for client to register pending Promise for response */
  _registerPendingRequest(
    requestId: string,
    resolve: (data: PostMessageData) => void,
    reject: (error: Error) => void,
    origin?: string
  ): void;
  /** Internal method: for client to cancel waiting */
  _unregisterPendingRequest(requestId: string): void;
}

/**
 * Server interface (used on server side, handles requests and responses)
 */
export interface RequestIframeServer {
  /** Message isolation key (read-only) */
  readonly secretKey?: string;
  /** Whether message handling is enabled */
  readonly isOpen: boolean;
  /** Enable message handling (register message handler) */
  open(): void;
  /** Disable message handling (unregister message handler, but don't release resources) */
  close(): void;
  /** 
   * Register middleware
   * - use(middleware): Register global middleware (executed before all routes)
   * - use(path, middleware): Register path-matching middleware (path supports string, RegExp, PathPattern, Array)
   */
  use(middleware: Middleware): void;
  use(path: PathMatcher, middleware: Middleware): void;
  /** Register route handler */
  on(path: string, handler: ServerHandler): void;
  /** Unregister route handler */
  off(path: string): void;
  /** Batch register route handlers (via key: value object) */
  map(handlers: Record<string, ServerHandler>): void;
  /** Destroy server (close and release resources) */
  destroy(): void;
}

/**
 * requestIframeClient entry options
 */
export interface RequestIframeClientOptions extends RequestDefaults {
  /**
   * Message isolation key.
   * If configured, automatically adds a unified prefix to the path of all messages (to avoid conflicts between different businesses), and only processes framework messages with the same secretKey.
   */
  secretKey?: string;
  /**
   * Whether to enable trace mode.
   * If true, logs will be printed at various points such as before and after requests.
   */
  trace?: boolean;
}

/**
 * requestIframeServer entry options
 */
export interface RequestIframeServerOptions extends Pick<RequestDefaults, 'ackTimeout'> {
  /**
   * Message isolation key.
   * If configured, automatically adds a unified prefix to the path of all messages (to avoid conflicts between different businesses), and only processes framework messages with the same secretKey.
   */
  secretKey?: string;
  /**
   * Whether to enable trace mode.
   * If true, logs will be printed at various points such as before and after requests, server receive/respond, etc.
   */
  trace?: boolean;
}
