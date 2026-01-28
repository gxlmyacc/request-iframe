import {
  RequestConfig,
  RequestOptions,
  Response,
  ErrorResponse,
  PostMessageData,
  RequestIframeClient,
  RequestDefaults,
  HeadersConfig,
  HeaderValue
} from '../types';
import {
  generateRequestId,
  generateInstanceId,
  CookieStore
} from '../utils';
import {
  RequestInterceptorManager,
  ResponseInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors
} from '../interceptors';
import { RequestIframeClientServer } from './client-server';
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
  headers?: HeadersConfig;
}

/**
 * RequestIframeClient implementation (only responsible for initiating requests, reuses server's listener)
 */
export class RequestIframeClientImpl implements RequestIframeClient, StreamMessageHandler {
  /** Unique instance ID */
  public readonly id: string;

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
  
  /** Initial headers configuration */
  private readonly initialHeaders?: HeadersConfig;
  
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

  /** 
   * Target server ID (remembered from responses)
   * When a response is received, we remember the server's creatorId as the targetId for future requests
   */
  private _targetServerId?: string;

  public constructor(
    targetWindow: Window,
    targetOrigin: string,
    server: RequestIframeClientServer,
    options?: ClientOptions,
    instanceId?: string
  ) {
    this.id = instanceId || generateInstanceId();
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.server = server;
    this.secretKey = options?.secretKey;
    
    // Set default timeout configuration
    this.defaultAckTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.defaultTimeout = options?.timeout ?? DefaultTimeout.REQUEST;
    this.defaultAsyncTimeout = options?.asyncTimeout ?? DefaultTimeout.ASYNC;
    
    // Save initial headers configuration
    this.initialHeaders = options?.headers;

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

  /*
   Send message (StreamMessageHandler interface implementation)
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
   * Resolve header value (handle function type headers)
   */
  private resolveHeaderValue(value: HeaderValue, config: RequestConfig): string | string[] {
    if (typeof value === 'function') {
      return value(config);
    }
    return value;
  }

  /**
   * Merge and resolve headers (initial headers + request headers)
   * Request headers take precedence over initial headers
   */
  private mergeHeaders(config: RequestConfig): Record<string, string | string[]> {
    const resolvedHeaders: Record<string, string | string[]> = {};

    // First, resolve initial headers
    if (this.initialHeaders) {
      for (const [key, value] of Object.entries(this.initialHeaders)) {
        resolvedHeaders[key] = this.resolveHeaderValue(value, config);
      }
    }

    // Then, merge request headers (request headers take precedence)
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        resolvedHeaders[key] = this.resolveHeaderValue(value, config);
      }
    }

    return resolvedHeaders;
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

    // Merge and resolve headers (initial headers + request headers)
    const mergedHeaders = this.mergeHeaders(processedConfig);

    const {
      path: processedPath,
      body: processedBody,
      cookies: processedCookies,
      targetId: userTargetId,
      ackTimeout = this.defaultAckTimeout,
      timeout = this.defaultTimeout,
      asyncTimeout = this.defaultAsyncTimeout,
      requestId = generateRequestId(),
    } = processedConfig;

    // Use user-specified targetId, or remembered target server ID, or undefined
    const targetId = userTargetId || this._targetServerId;

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
        // Run response interceptors to allow error logging
        Promise.reject(error)
          .catch((err) => {
            // Run through response interceptors' rejected callbacks
            let promise: Promise<any> = Promise.reject(err);
            this.interceptors.response.forEach((interceptor) => {
              promise = promise.catch((e) => {
                if (interceptor.rejected) {
                  return interceptor.rejected(e);
                }
                return Promise.reject(e);
              });
            });
            return promise;
          })
          .catch(() => {
            // After interceptors, reject with original error
            reject(error);
          });
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
            // Remember server's creatorId as target server ID for future requests
            if (data.creatorId && !this._targetServerId) {
              this._targetServerId = data.creatorId;
            }
            // Switch to request timeout
            setRequestTimeout();
            return;
          }

          // Received ASYNC notification: this is an async task
          if (data.type === MessageType.ASYNC) {
            // Remember server's creatorId as target server ID for future requests
            if (data.creatorId && !this._targetServerId) {
              this._targetServerId = data.creatorId;
            }
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
            const autoResolve = streamBody.autoResolve ?? false;

            // Create corresponding readable stream based on stream type
            if (streamType === StreamTypeConstant.FILE) {
              const readableStream = new IframeFileReadableStream(
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

              // If autoResolve is enabled, automatically read and convert to File/Blob
              if (autoResolve) {
                // Extract fileName from headers if available
                const contentDisposition = data.headers?.[HttpHeader.CONTENT_DISPOSITION];
                let fileName: string | undefined;
                if (contentDisposition) {
                  const disposition = typeof contentDisposition === 'string' ? contentDisposition : contentDisposition[0];
                  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
                  if (filenameMatch) {
                    fileName = filenameMatch[1];
                  }
                }
                // Fallback to stream metadata if not found in headers
                fileName = fileName || streamMetadata?.filename || readableStream.filename;

                // Use stream's readAsFile or readAsBlob method
                const fileDataPromise = fileName
                  ? readableStream.readAsFile(fileName)
                  : readableStream.readAsBlob();

                fileDataPromise
                  .then((fileData: File | Blob) => {
                    const resp: Response<T> = {
                      data: fileData as any,
                      status: data.status || HttpStatus.OK,
                      statusText: data.statusText || HttpStatusText[HttpStatus.OK],
                      requestId,
                      headers: data.headers
                    };
                    
                    return runResponseInterceptors(this.interceptors.response, resp);
                  })
                  .then(resolve)
                  .catch(reject);
                return;
              }

              // Non-autoResolve: return file stream directly
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

            // Non-file stream: create regular readable stream
            const readableStream = new IframeReadableStream<T>(
              streamId,
              requestId,
              this,
              {
                type: streamType,
                chunked: streamChunked,
                metadata: streamMetadata
              }
            );

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

            // Remember server's creatorId as target server ID for future requests
            if (data.creatorId && !this._targetServerId) {
              this._targetServerId = data.creatorId;
            }

            // If server requires acknowledgment, send received message
            if (data.requireAck) {
              this.server.messageDispatcher.sendMessage(
                this.targetWindow,
                this.targetOrigin,
                MessageType.RECEIVED,
                requestId,
                { 
                  path: prefixedPath,
                  targetId: data.creatorId
                }
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
              headers: data.headers
            };
            runResponseInterceptors(this.interceptors.response, resp)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Received error
          if (data.type === MessageType.ERROR) {
            // Remember server's creatorId as target server ID for future requests
            if (data.creatorId && !this._targetServerId) {
              this._targetServerId = data.creatorId;
            }

            // If server requires acknowledgment, send received message
            if (data.requireAck) {
              this.server.messageDispatcher.sendMessage(
                this.targetWindow,
                this.targetOrigin,
                MessageType.RECEIVED,
                requestId,
                { 
                  path: prefixedPath,
                  targetId: data.creatorId
                }
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
          headers: mergedHeaders,
          cookies: mergedCookies,
          targetId
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
   * Whether message handling is enabled
   */
  public get isOpen(): boolean {
    return this.server.isOpen;
  }

  /**
   * Enable message handling (register message handlers)
   */
  public open(): void {
    this.server.open();
  }

  /**
   * Disable message handling (unregister message handlers, but don't release resources)
   */
  public close(): void {
    this.server.close();
  }

  /**
   * Destroy client (close and release all resources)
   */
  public destroy(): void {
    // Clear cookies
    this._cookieStore.clear();
    
    // Clear stream handlers
    this.streamHandlers.clear();
    
    // Clear interceptors
    this.interceptors.request.clear();
    this.interceptors.response.clear();
    
    // Destroy server (this will also release the message channel)
    this.server.destroy();
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
