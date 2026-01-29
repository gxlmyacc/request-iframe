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
import { RequestIframeError } from '../utils';
import { detectContentType, blobToBase64, isWindowAvailable } from '../utils';
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
  IframeWritableStream,
  isIframeWritableStream,
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

  public readonly targetWindow: Window;
  private readonly targetOrigin: string;
  private readonly server: RequestIframeClientServer;
  private readonly secretKey?: string;
  
  /** Default timeout configuration */
  private readonly defaultAckTimeout: number;
  private readonly defaultTimeout: number;
  private readonly defaultAsyncTimeout: number;
  
  /** Default returnData configuration */
  private readonly defaultReturnData: boolean;
  
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
    
    // Set default returnData configuration
    this.defaultReturnData = options?.returnData ?? false;
    
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
    // Window check is handled in MessageDispatcher
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
   * Detect Content-Type for request body
   */
  private detectContentTypeForBody(body: any): string | null {
    return detectContentType(body, { checkStream: false });
  }

  /**
   * Check if header exists (case-insensitive)
   */
  private hasHeader(headers: Record<string, string | string[]>, name: string): boolean {
    const lower = name.toLowerCase();
    return Object.keys(headers).some((k) => k.toLowerCase() === lower);
  }

  /**
   * Merge and resolve headers (initial headers + request headers)
   * Request headers take precedence over initial headers
   * Also auto-detects and sets Content-Type if not already set
   */
  private mergeHeaders(config: RequestConfig, body?: any): Record<string, string | string[]> {
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

    // Auto-detect and set Content-Type if not already set and body is provided
    if (body !== undefined && !this.hasHeader(resolvedHeaders, HttpHeader.CONTENT_TYPE)) {
      const contentType = this.detectContentTypeForBody(body);
      if (contentType) {
        resolvedHeaders[HttpHeader.CONTENT_TYPE] = contentType;
      }
    }

    return resolvedHeaders;
  }

  /**
   * Check if server is reachable
   */
  public isConnect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId();
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.server._unregisterPendingRequest(requestId);
      };

      // Check if target window is still available before sending ping
      if (!isWindowAvailable(this.targetWindow)) {
        reject(new RequestIframeError({
          message: Messages.TARGET_WINDOW_CLOSED,
          code: ErrorCode.TARGET_WINDOW_CLOSED,
          config: undefined,
          requestId
        }));
        return;
      }

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
    body?: any,
    options?: RequestOptions
  ): Promise<Response<T> | T> {
    const config: RequestConfig = {
      path,
      body,
      ...options
    };

    const processedConfig = await runRequestInterceptors(
      this.interceptors.request,
      config
    );

    const processedBody = processedConfig.body;

    // Universal send: dispatch by type (like response.send)
    if (
      (typeof File !== 'undefined' && processedBody instanceof File) ||
      (typeof Blob !== 'undefined' && processedBody instanceof Blob)
    ) {
      return this.sendFile(path, processedBody, options);
    }
    if (isIframeWritableStream(processedBody)) {
      return this.sendStream(path, processedBody, options);
    }

    // Merge and resolve headers (initial headers + request headers)
    const mergedHeaders = this.mergeHeaders(processedConfig, processedBody);

    const {
      path: processedPath,
      cookies: processedCookies,
      targetId: userTargetId,
      requestId = generateRequestId(),
    } = processedConfig;

    const targetId = userTargetId || this._targetServerId;

    return this._sendRequest<T>(
      processedPath,
      processedBody,
      mergedHeaders,
      processedCookies,
      processedConfig,
      requestId,
      targetId
    );
  }

  /**
   * Send file as request body (stream only; server receives stream or auto-resolved File/Blob via autoResolve).
   */
  public async sendFile<T = any>(
    path: string,
    content: string | Blob | File,
    options?: RequestOptions & { mimeType?: string; fileName?: string; autoResolve?: boolean }
  ): Promise<Response<T> | T> {
    const streamAutoResolve = options?.autoResolve ?? true;
    const mimeType = options?.mimeType;
    const fileName = options?.fileName;

    const { IframeFileWritableStream } = await import('../stream');
    const fileStream = new IframeFileWritableStream({
      filename: fileName || (typeof File !== 'undefined' && content instanceof File ? content.name : 'file'),
      mimeType: mimeType || (typeof File !== 'undefined' && content instanceof File ? content.type : (content as any)?.type) || 'application/octet-stream',
      chunked: false,
      autoResolve: streamAutoResolve,
      next: async () => {
        const data =
          typeof content === 'string'
            ? btoa(unescape(encodeURIComponent(content)))
            : await blobToBase64(content as Blob);
        return { data, done: true };
      }
    });

    return this.sendStream<T>(path, fileStream as any, options);
  }

  /**
   * Send stream as request body (server receives readable stream).
   * Sends REQUEST with streamId and stream: true, then starts the writable stream.
   */
  public async sendStream<T = any>(
    path: string,
    stream: IframeWritableStream,
    options?: RequestOptions
  ): Promise<Response<T> | T> {
    const config: RequestConfig = {
      path,
      body: undefined,
      ...options
    };
    const processedConfig = await runRequestInterceptors(
      this.interceptors.request,
      config
    );
    const requestId = processedConfig.requestId ?? generateRequestId();
    const targetId = processedConfig.targetId ?? this._targetServerId;
    const processedPath = processedConfig.path;

    stream._bind({
      requestId,
      targetWindow: this.targetWindow,
      targetOrigin: this.targetOrigin,
      secretKey: this.secretKey,
      channel: this.server.messageDispatcher.getChannel(),
      clientId: this.id,
      targetId
    });

    const mergedHeaders = this.mergeHeaders(processedConfig, undefined);
    const pathMatchedCookies = this._cookieStore.getForPath(processedPath);
    const mergedCookies = { ...pathMatchedCookies, ...processedConfig.cookies };

    const streamConfig = { ...processedConfig, requestId };
    const promise = this._sendRequest<T>(
      processedPath,
      undefined,
      mergedHeaders,
      mergedCookies,
      streamConfig,
      requestId,
      targetId,
      { streamId: stream.streamId }
    );

    /** Start stream after REQUEST is sent (_sendRequest sends synchronously in executor) */
    void stream.start();
    return promise;
  }

  /**
   * Internal: send REQUEST and wait for response (used by send, sendFile, sendStream).
   */
  private _sendRequest<T = any>(
    requestPath: string,
    body: any,
    mergedHeaders: Record<string, string | string[]>,
    processedCookies: Record<string, string> | undefined,
    processedConfig: RequestConfig,
    requestId: string,
    targetId: string | undefined,
    extraPayload?: { streamId?: string }
  ): Promise<Response<T> | T> {
    const {
      ackTimeout = this.defaultAckTimeout,
      timeout = this.defaultTimeout,
      asyncTimeout = this.defaultAsyncTimeout,
      returnData = this.defaultReturnData
    } = processedConfig;

    return new Promise<Response<T> | T>((resolve, reject) => {
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
        // Convert to RequestIframeError instance
        const errorInstance = error instanceof RequestIframeError ? error : new RequestIframeError(error);
        // Run response interceptors to allow error logging
        Promise.reject(errorInstance)
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
            reject(errorInstance);
          });
      };

      const setAckTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail(new RequestIframeError({
            message: formatMessage(Messages.ACK_TIMEOUT, ackTimeout),
            code: ErrorCode.ACK_TIMEOUT,
            config: processedConfig,
            requestId
          }));
        }, ackTimeout);
      };

      const setRequestTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail(new RequestIframeError({
            message: formatMessage(Messages.REQUEST_TIMEOUT, timeout),
            code: ErrorCode.TIMEOUT,
            config: processedConfig,
            requestId
          }));
        }, timeout);
      };

      const setAsyncTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fail(new RequestIframeError({
            message: formatMessage(Messages.ASYNC_REQUEST_TIMEOUT, asyncTimeout),
            code: ErrorCode.ASYNC_TIMEOUT,
            config: processedConfig,
            requestId
          }));
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
                  .then((response) => {
                    resolve(returnData ? response.data : response);
                  })
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
                .then((response) => {
                  resolve(returnData ? response.data : response);
                })
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
              .then((response) => {
                resolve(returnData ? response.data : response);
              })
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
              // Check if target window is still available before sending
              if (isWindowAvailable(this.targetWindow)) {
                this.server.messageDispatcher.sendMessage(
                  this.targetWindow,
                  this.targetOrigin,
                  MessageType.RECEIVED,
                  requestId,
                  { 
                    path: requestPath,
                    targetId: data.creatorId
                  }
                );
              }
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
              .then((response) => {
                resolve(returnData ? response.data : response);
              })
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
              // Window check is handled in MessageDispatcher
              this.server.messageDispatcher.sendMessage(
                this.targetWindow,
                this.targetOrigin,
                MessageType.RECEIVED,
                requestId,
                { 
                  path: requestPath,
                  targetId: data.creatorId
                }
              );
            }

            fail(new RequestIframeError({
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
            }));
          }
        },
        (error: Error) => {
          fail(new RequestIframeError({
            message: error.message || Messages.REQUEST_FAILED,
            code: ErrorCode.REQUEST_ERROR,
            config: processedConfig,
            requestId
          }));
        },
        this.targetOrigin
      );

      // Set ACK timeout
      setAckTimeout();

      // Get cookies matching request path and merge with user-provided cookies (user-provided takes precedence)
      const pathMatchedCookies = this._cookieStore.getForPath(requestPath);
      const mergedCookies = { ...pathMatchedCookies, ...processedCookies };

      // Send request via MessageDispatcher
      const payload: Record<string, any> = {
        path: requestPath,
        body,
        headers: mergedHeaders,
        cookies: mergedCookies,
        targetId
      };
      if (extraPayload?.streamId) {
        payload.streamId = extraPayload.streamId;
      }

      // Check if target window is still available before sending
      if (!isWindowAvailable(this.targetWindow)) {
        fail(new RequestIframeError({
          message: Messages.TARGET_WINDOW_CLOSED,
          code: ErrorCode.TARGET_WINDOW_CLOSED,
          config: processedConfig,
          requestId
        }));
        return;
      }

      this.server.messageDispatcher.sendMessage(
        this.targetWindow,
        this.targetOrigin,
        MessageType.REQUEST,
        requestId,
        payload
      );
    });
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
   * Check if target window is still available (not closed/removed)
   * @returns true if target window is available, false otherwise
   */
  public isAvailable(): boolean {
    return isWindowAvailable(this.targetWindow);
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
