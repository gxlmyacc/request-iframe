import {
  RequestConfig,
  RequestOptions,
  Response,
  ErrorResponse,
  PostMessageData,
  RequestIframeClient,
  RequestDefaults
} from '../types';
import {
  generateRequestId,
  CookieStore
} from '../utils';
import {
  RequestInterceptorManager,
  ResponseInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors
} from '../interceptors';
import { RequestIframeClientServer } from './server-client';
import {
  DefaultTimeout,
  ErrorCode,
  MessageType,
  HttpStatus,
  HttpStatusText,
  HttpHeader,
  Messages,
  formatMessage,
  StreamType as StreamTypeConstant
} from '../constants';
import {
  IframeReadableStream,
  IframeFileReadableStream,
  StreamMessageHandler,
  StreamMessageData
} from '../stream';

/**
 * Client configuration options
 */
export interface ClientOptions extends RequestDefaults {
  secretKey?: string;
}

/**
 * RequestIframeClient implementation (only responsible for initiating requests, reuses server's listener)
 */
export class RequestIframeClientImpl implements RequestIframeClient, StreamMessageHandler {
  public interceptors = {
    request: new RequestInterceptorManager(),
    response: new ResponseInterceptorManager()
  };

  private readonly targetWindow: Window;
  private readonly targetOrigin: string;
  private readonly server: RequestIframeClientServer;
  private readonly secretKey?: string;
  
  /** Default timeout configuration */
  private readonly defaultAckTimeout: number;
  private readonly defaultTimeout: number;
  private readonly defaultAsyncTimeout: number;
  
  /** 
   * Internal cookies storage
   * - Automatically includes cookies matching the path when sending requests
   * - Automatically parses Set-Cookie and saves when receiving response
   */
  private _cookieStore: CookieStore = new CookieStore();

  /** 
   * Stream message handler map
   * key: streamId
   * value: stream message handler function
   */
  private readonly streamHandlers = new Map<string, (data: StreamMessageData) => void>();

  public constructor(
    targetWindow: Window,
    targetOrigin: string,
    server: RequestIframeClientServer,
    options?: ClientOptions
  ) {
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.server = server;
    this.secretKey = options?.secretKey;
    
    // Set default timeout configuration
    this.defaultAckTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.defaultTimeout = options?.timeout ?? DefaultTimeout.REQUEST;
    this.defaultAsyncTimeout = options?.asyncTimeout ?? DefaultTimeout.ASYNC;

    // Register stream message processing callback
    this.server.setStreamCallback((data) => {
      this.dispatchStreamMessage(data);
    });
  }

  /**
   * Register stream message handler (StreamMessageHandler interface implementation)
   */
  public registerStreamHandler(streamId: string, handler: (data: StreamMessageData) => void): void {
    this.streamHandlers.set(streamId, handler);
  }

  /**
   * Unregister stream message handler (StreamMessageHandler interface implementation)
   */
  public unregisterStreamHandler(streamId: string): void {
    this.streamHandlers.delete(streamId);
  }

  /**
   * Send message (StreamMessageHandler interface implementation)
   */
  public postMessage(message: any): void {
    this.server.messageDispatcher.send(this.targetWindow, message, this.targetOrigin);
  }

  /**
   * Dispatch stream message to corresponding handler
   */
  private dispatchStreamMessage(data: PostMessageData): void {
    const body = data.body as StreamMessageData;
    if (!body || !body.streamId) return;
    
    const handler = this.streamHandlers.get(body.streamId);
    if (handler) {
      // Extract message type (remove stream_ prefix)
      const messageType = (data.type as string).replace('stream_', '');
      handler({ ...body, type: messageType as any });
    }
  }

  /**
   * Check if server is reachable
   */
  public isConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = generateRequestId();
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.server._unregisterPendingRequest(requestId);
      };

      this.server._registerPendingRequest(
        requestId,
        (data: PostMessageData) => {
          if (done) return;
          if (data.type === MessageType.PONG) {
            done = true;
            cleanup();
            resolve(true);
          }
        },
        () => {
          if (done) return;
          done = true;
          cleanup();
          resolve(false);
        },
        this.targetOrigin
      );

      timeoutId = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve(false);
      }, this.defaultAckTimeout);

      // Send ping via MessageDispatcher
      this.server.messageDispatcher.sendMessage(
        this.targetWindow,
        this.targetOrigin,
        MessageType.PING,
        requestId
      );
    });
  }

  public async send<T = any>(
    path: string,
    body?: Record<string, any>,
    options?: RequestOptions
  ): Promise<Response<T>> {
    const config: RequestConfig = {
      path,
      body,
      ...options
    };

    const processedConfig = await runRequestInterceptors(
      this.interceptors.request,
      config
    );

    const {
      path: processedPath,
      body: processedBody,
      headers: processedHeaders,
      cookies: processedCookies,
      ackTimeout = this.defaultAckTimeout,
      timeout = this.defaultTimeout,
      asyncTimeout = this.defaultAsyncTimeout,
      requestId = generateRequestId()
    } = processedConfig;

    return new Promise<Response<T>>((resolve, reject) => {
      const prefixedPath = this.prefixPath(processedPath);
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.server._unregisterPendingRequest(requestId);
      };

      const fail = (error: ErrorResponse) => {
        if (done) return;
        done = true;
        cleanup();
        reject(error);
      };

      const setAckTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail({
            message: formatMessage(Messages.ACK_TIMEOUT, ackTimeout),
            code: ErrorCode.ACK_TIMEOUT,
            config: processedConfig,
            requestId
          });
        }, ackTimeout);
      };

      const setRequestTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail({
            message: formatMessage(Messages.REQUEST_TIMEOUT, timeout),
            code: ErrorCode.TIMEOUT,
            config: processedConfig,
            requestId
          });
        }, timeout);
      };

      const setAsyncTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail({
            message: formatMessage(Messages.ASYNC_REQUEST_TIMEOUT, asyncTimeout),
            code: ErrorCode.ASYNC_TIMEOUT,
            config: processedConfig,
            requestId
          });
        }, asyncTimeout);
      };

      // Register to server's pending requests
      this.server._registerPendingRequest(
        requestId,
        (data: PostMessageData) => {
          if (done) return;

          // Received ACK: server has received request
          if (data.type === MessageType.ACK) {
            // Switch to request timeout
            setRequestTimeout();
            return;
          }

          // Received ASYNC notification: this is an async task
          if (data.type === MessageType.ASYNC) {
            // Switch to async timeout
            setAsyncTimeout();
            return;
          }

          // Received stream start message
          if (data.type === MessageType.STREAM_START) {
            done = true;
            cleanup();

            const streamBody = data.body as StreamMessageData;
            const streamId = streamBody.streamId;
            const streamType = streamBody.type || StreamTypeConstant.DATA;
            const streamChunked = streamBody.chunked ?? true;
            const streamMetadata = streamBody.metadata;

            // Create corresponding readable stream based on stream type
            let readableStream: IframeReadableStream<T> | IframeFileReadableStream;
            
            if (streamType === StreamTypeConstant.FILE) {
              readableStream = new IframeFileReadableStream(
                streamId,
                requestId,
                this,
                {
                  chunked: streamChunked,
                  metadata: streamMetadata,
                  filename: streamMetadata?.filename,
                  mimeType: streamMetadata?.mimeType,
                  size: streamMetadata?.size
                }
              );
            } else {
              readableStream = new IframeReadableStream<T>(
                streamId,
                requestId,
                this,
                {
                  type: streamType,
                  chunked: streamChunked,
                  metadata: streamMetadata
                }
              );
            }

            const resp: Response<T> = {
              data: undefined as any,
              status: data.status || HttpStatus.OK,
              statusText: data.statusText || HttpStatusText[HttpStatus.OK],
              requestId,
              headers: data.headers,
              stream: readableStream as any
            };
            
            runResponseInterceptors(this.interceptors.response, resp)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Received stream data/end/error/cancel message - dispatch to stream handler
          if ((data.type as string).startsWith('stream_')) {
            this.dispatchStreamMessage(data);
            return;
          }

          // Received response
          if (data.type === MessageType.RESPONSE) {
            done = true;
            cleanup();

            // If server requires acknowledgment, send received message
            if (data.requireAck) {
              this.server.messageDispatcher.sendMessage(
                this.targetWindow,
                this.targetOrigin,
                MessageType.RECEIVED,
                requestId,
                { path: prefixedPath }
              );
            }

            // Parse and save server-set cookies (from Set-Cookie header)
            if (data.headers && data.headers[HttpHeader.SET_COOKIE]) {
              const setCookies = data.headers[HttpHeader.SET_COOKIE];
              const setCookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];
              for (const setCookieStr of setCookieArray) {
                this._cookieStore.setFromSetCookie(setCookieStr);
              }
            }

            const resp: Response<T> = {
              data: data.data,
              status: data.status || HttpStatus.OK,
              statusText: data.statusText || HttpStatusText[HttpStatus.OK],
              requestId,
              headers: data.headers,
              fileData: data.fileData
            };
            runResponseInterceptors(this.interceptors.response, resp)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Received error
          if (data.type === MessageType.ERROR) {
            // If server requires acknowledgment, send received message
            if (data.requireAck) {
              this.server.messageDispatcher.sendMessage(
                this.targetWindow,
                this.targetOrigin,
                MessageType.RECEIVED,
                requestId,
                { path: prefixedPath }
              );
            }

            const err: ErrorResponse = {
              message: data.error?.message || Messages.REQUEST_FAILED,
              code: data.error?.code || ErrorCode.REQUEST_ERROR,
              config: processedConfig,
              response: data.status
                ? {
                    data: data.data,
                    status: data.status,
                    statusText: data.statusText || Messages.ERROR
                  }
                : undefined,
              requestId
            };
            fail(err);
          }
        },
        (error: Error) => {
          fail({
            message: error.message || Messages.REQUEST_FAILED,
            code: ErrorCode.REQUEST_ERROR,
            config: processedConfig,
            requestId
          });
        },
        this.targetOrigin
      );

      // Set ACK timeout
      setAckTimeout();

      // Get cookies matching request path and merge with user-provided cookies (user-provided takes precedence)
      const pathMatchedCookies = this._cookieStore.getForPath(processedPath);
      const mergedCookies = { ...pathMatchedCookies, ...processedCookies };

      // Send request via MessageDispatcher
      this.server.messageDispatcher.sendMessage(
        this.targetWindow,
        this.targetOrigin,
        MessageType.REQUEST,
        requestId,
        {
          path: prefixedPath,
          body: processedBody,
          headers: processedHeaders,
          cookies: mergedCookies
        }
      );
    });
  }

  private prefixPath(path: string): string {
    return this.secretKey ? `${this.secretKey}:${path}` : path;
  }

  /**
   * Get internal server instance (for debugging)
   */
  public getServer(): RequestIframeClientServer {
    return this.server;
  }

  /**
   * Get all cookies matching specified path
   * @param path Request path, returns all cookies if not provided
   */
  public getCookies(path?: string): Record<string, string> {
    if (path) {
      return this._cookieStore.getForPath(path);
    }
    return this._cookieStore.getAllSimple();
  }

  /**
   * Get specified cookie
   * @param name Cookie name
   * @param path Path (optional)
   */
  public getCookie(name: string, path?: string): string | undefined {
    return this._cookieStore.get(name, path);
  }

  /**
   * Set cookie
   * @param name Cookie name
   * @param value Cookie value
   * @param options Cookie options (path, etc.)
   */
  public setCookie(
    name: string, 
    value: string, 
    options?: { path?: string; expires?: Date; maxAge?: number }
  ): void {
    let expires: number | undefined;
    if (options?.expires) {
      expires = options.expires.getTime();
    } else if (options?.maxAge !== undefined) {
      expires = Date.now() + options.maxAge * 1000;
    }
    
    this._cookieStore.set({
      name,
      value,
      path: options?.path ?? '/',
      expires
    });
  }

  /**
   * Remove specified cookie
   * @param name Cookie name
   * @param path Path (optional, defaults to '/')
   */
  public removeCookie(name: string, path?: string): void {
    this._cookieStore.remove(name, path ?? '/');
  }

  /**
   * Clear all cookies
   */
  public clearCookies(): void {
    this._cookieStore.clear();
  }
}
