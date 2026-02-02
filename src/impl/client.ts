import type {
  RequestConfig,
  RequestOptions,
  Response,
  ErrorResponse,
  PostMessageData,
  RequestIframeClient,
  RequestDefaults,
  HeadersConfig,
  HeaderValue,
  OriginMatcher,
  OriginValidator
} from '../types';
import { RequestIframeError } from '../utils/error';
import { isExpectedAckMatch } from '../endpoint';
import { detectContentType } from '../utils/content-type';
import { isWindowAvailable } from '../utils/window';
import { generateRequestId, generateInstanceId } from '../utils/id';
import { CookieStore } from '../utils/cookie';
import {
  RequestInterceptorManager,
  ResponseInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors
} from '../interceptors';
import {
  RequestIframeEndpointHub,
  RequestIframeEndpointFacade,
  RequestIframeEndpointInbox,
  RequestIframeEndpointOutbox,
  RequestIframeStreamDispatcher,
  createReadableStreamFromStart
} from '../endpoint';
import { autoResolveIframeFileReadableStream } from '../endpoint';
import {
  DefaultTimeout,
  ErrorCode,
  MessageType,
  MessageRole,
  HttpStatus,
  HttpStatusText,
  HttpHeader,
  Messages,
  formatMessage,
  StreamType as StreamTypeConstant
} from '../constants';
import {
  IframeFileReadableStream,
  IframeWritableStream,
  StreamMessageHandler,
  StreamMessageData
} from '../stream';
import type { MessageContext } from '../message';
import { isFunction } from '../utils/is';

/**
 * Client configuration options
 */
export interface ClientOptions extends RequestDefaults {
  secretKey?: string;
  headers?: HeadersConfig;
  allowedOrigins?: OriginMatcher;
  validateOrigin?: OriginValidator;
  /** Whether to automatically open when creating the client. Default is true. */
  autoOpen?: boolean;
  /** @internal Advanced: auto-ack echo limit for ack.meta length. */
  autoAckMaxMetaLength?: number;
  /** @internal Advanced: auto-ack echo limit for ack.id length. */
  autoAckMaxIdLength?: number;
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
  private readonly endpoint: RequestIframeEndpointFacade;
  private readonly hub: RequestIframeEndpointHub;
  private readonly inbox: RequestIframeEndpointInbox;
  private readonly outbox: RequestIframeEndpointOutbox;
  private readonly secretKey?: string;
  private readonly originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean;
  
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

  private readonly streamDispatcher: RequestIframeStreamDispatcher;

  /** 
   * Target server ID (remembered from responses)
   * When a response is received, we remember the server's creatorId as the targetId for future requests
   */
  private _targetServerId?: string;

  private rememberTargetServerId(serverId?: string): void {
    if (!serverId) return;
    if (!this._targetServerId) {
      this._targetServerId = serverId;
      this.outbox.setDefaultTargetId(serverId);
    }
  }

  public constructor(
    targetWindow: Window,
    targetOrigin: string,
    options?: ClientOptions,
    instanceId?: string
  ) {
    this.id = instanceId || generateInstanceId();
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.secretKey = options?.secretKey;

    const endpoint = new RequestIframeEndpointFacade({
      role: MessageRole.CLIENT,
      instanceId: this.id,
      secretKey: options?.secretKey,
      autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
      autoAckMaxIdLength: options?.autoAckMaxIdLength,
      inbox: {},
      streamDispatcher: { handledBy: this.id },
      originValidator: {
        allowedOrigins: options?.allowedOrigins,
        validateOrigin: options?.validateOrigin
      }
    });

    this.endpoint = endpoint;
    /** Core/routers shared composition */
    this.hub = endpoint.hub;
    this.streamDispatcher = endpoint.streamDispatcher;
    this.inbox = endpoint.inbox as RequestIframeEndpointInbox;
    this.originValidator = endpoint.originValidator;

    /** Create a fixed-peer sender (built-in client) */
    this.outbox = this.hub.createOutbox(this.targetWindow, this.targetOrigin);

    /**
     * Register base message infra + response handlers via facade.
     * These hooks will run when client.open() is called.
     */
    this.endpoint.onOpen(() => this.inbox.registerHandlers());

    // Provide fallback target for auto-ack (useful when MessageEvent.source is missing in tests)
    this.hub.setFallbackTarget(this.outbox.targetWindow, this.outbox.targetOrigin);

    // Set default timeout configuration
    this.defaultAckTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.defaultTimeout = options?.timeout ?? DefaultTimeout.REQUEST;
    this.defaultAsyncTimeout = options?.asyncTimeout ?? DefaultTimeout.ASYNC;
    
    // Set default returnData configuration
    this.defaultReturnData = options?.returnData ?? false;
    
    // Save initial headers configuration
    this.initialHeaders = options?.headers;

    // Stream dispatching is owned by facade (pluggable stream infra)
    this.endpoint.enableStreamDispatcherCallback({
      isOriginAllowed: (d, ctx) => this.hub.isOriginAllowedBy(ctx.origin, d, ctx, this.targetOrigin, this.originValidator)
    });
    this.endpoint.registerClientStreamCallbackHandlers({
      handlerOptions: this.hub.createHandlerOptions(() => {
        /** ignore version errors for stream frames */
      })
    });

    /** Auto-open by default (unless explicitly set to false) */
    if (options?.autoOpen !== false) {
      this.open();
    }
  }

  /**
   * Register stream message handler (StreamMessageHandler interface implementation)
   */
  public registerStreamHandler(streamId: string, handler: (data: StreamMessageData) => void): void {
    this.streamDispatcher.register(streamId, handler);
  }

  /**
   * Unregister stream message handler (StreamMessageHandler interface implementation)
   */
  public unregisterStreamHandler(streamId: string): void {
    this.streamDispatcher.unregister(streamId);
  }

  /*
   Send message (StreamMessageHandler interface implementation)
   */
  public postMessage(message: any): void {
    this.sendRaw(message);
  }

  /**
   * Send raw framework message (advanced).
   *
   * Note: streams call `postMessage` via StreamMessageHandler, which delegates here.
   */
  public sendRaw(message: any): void {
    // Window check is handled in MessageDispatcher
    this.outbox.sendRaw(message as any);
  }

  /**
   * Resolve header value (handle function type headers)
   */
  private resolveHeaderValue(value: HeaderValue, config: RequestConfig): string | string[] {
    if (isFunction<[RequestConfig], string | string[]>(value)) {
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
    // Check if target window is still available before sending ping
    if (!isWindowAvailable(this.targetWindow)) {
      return Promise.reject(new RequestIframeError({
        message: Messages.TARGET_WINDOW_CLOSED,
        code: ErrorCode.TARGET_WINDOW_CLOSED,
        config: undefined,
        requestId: `ping_${Date.now()}`
      }));
    }

    return this.endpoint.pingIsConnect({
      peer: this.outbox,
      timeoutMs: this.defaultAckTimeout,
      targetOrigin: this.targetOrigin,
      targetId: this._targetServerId,
      onPeerId: (serverId) => this.rememberTargetServerId(serverId)
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

    return this.outbox.send<Response<T> | T>({
      data: processedBody,
      onFileOrBlob: () => {
        return this.sendFile(path, processedBody, options);
      },
      onStream: () => {
        return this.sendStream(path, processedBody, options);
      },
      onOther: () => {
        // Merge and resolve headers (initial headers + request headers)
        const mergedHeaders = this.mergeHeaders(processedConfig, processedBody);

        const {
          path: processedPath,
          cookies: processedCookies,
          targetId: userTargetId,
          requestId = generateRequestId()
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
    });
  }

  /**
   * Send file as request body (stream only; server receives stream or auto-resolved File/Blob via autoResolve).
   */
  public async sendFile<T = any>(
    path: string,
    content: string | Blob | File,
    options?: RequestOptions & { mimeType?: string; fileName?: string; autoResolve?: boolean }
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

    const mergedHeaders = this.mergeHeaders(processedConfig, undefined);
    const pathMatchedCookies = this._cookieStore.getForPath(processedPath);
    const mergedCookies = { ...pathMatchedCookies, ...processedConfig.cookies };

    const streamConfig = { ...processedConfig, requestId };

    return this.outbox.sendFile<Response<T> | T>({
      content,
      fileName: options?.fileName,
      mimeType: options?.mimeType,
      chunked: false,
      autoResolve: options?.autoResolve ?? true,
      defaultFileName: typeof File !== 'undefined' && content instanceof File ? content.name : 'file',
      defaultMimeType: 'application/octet-stream',
      stream: {
        bind: {
          requestId,
          registerStreamHandler: this.registerStreamHandler.bind(this),
          unregisterStreamHandler: this.unregisterStreamHandler.bind(this),
          heartbeat: () => this.isConnect(),
          clientId: this.id,
          targetId
        },
        awaitStart: false,
        beforeStart: ({ stream }) => {
          return this._sendRequest<T>(
            processedPath,
            undefined,
            mergedHeaders,
            mergedCookies,
            streamConfig,
            requestId,
            targetId,
            { streamId: (stream as any).streamId }
          );
        }
      }
    });
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

    const mergedHeaders = this.mergeHeaders(processedConfig, undefined);
    const pathMatchedCookies = this._cookieStore.getForPath(processedPath);
    const mergedCookies = { ...pathMatchedCookies, ...processedConfig.cookies };

    const streamConfig = { ...processedConfig, requestId };

    return this.outbox.sendStream<Response<T> | T>({
      stream: stream as any,
      bind: {
        requestId,
        registerStreamHandler: this.registerStreamHandler.bind(this),
        unregisterStreamHandler: this.unregisterStreamHandler.bind(this),
        heartbeat: () => this.isConnect(),
        clientId: this.id,
        targetId
      },
      awaitStart: false,
      beforeStart: ({ stream: s }) => {
        return this._sendRequest<T>(
          processedPath,
          undefined,
          mergedHeaders,
          mergedCookies,
          streamConfig,
          requestId,
          targetId,
          { streamId: (s as any).streamId }
        );
      }
    });
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
      requireAck = true,
      streamTimeout,
        ack,
      returnData = this.defaultReturnData
    } = processedConfig;

    return new Promise<Response<T> | T>((resolve, reject) => {
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.inbox.unregisterPendingRequest(requestId);
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
      this.inbox.registerPendingRequest(
        requestId,
        (data: PostMessageData) => {
          if (done) return;

          // Received ACK: server has received request
          if (data.type === MessageType.ACK) {
            // Optional ack match (ignore mismatched ACK)
            if (!isExpectedAckMatch(ack, (data as any).ack)) {
              return;
            }
            // Remember server's creatorId as target server ID for future requests
            this.rememberTargetServerId(data.creatorId);
            // Switch to request timeout
            setRequestTimeout();
            return;
          }

          // Received ASYNC notification: this is an async task
          if (data.type === MessageType.ASYNC) {
            // Remember server's creatorId as target server ID for future requests
            this.rememberTargetServerId(data.creatorId);
            // Switch to async timeout
            setAsyncTimeout();
            return;
          }

          // Received stream start message
          if (data.type === MessageType.STREAM_START) {
            done = true;
            cleanup();

            // Remember server's creatorId as target server ID for future requests
            this.rememberTargetServerId(data.creatorId);

            const created = createReadableStreamFromStart({
              requestId,
              data,
              handler: this,
              secretKey: this.secretKey,
              idleTimeout: streamTimeout,
              heartbeat: () => this.isConnect()
            });
            if (!created) {
              fail(new RequestIframeError({
                message: formatMessage(Messages.STREAM_ERROR, 'invalid stream_start'),
                code: ErrorCode.STREAM_ERROR,
                config: processedConfig,
                requestId
              }));
              return;
            }

            const { stream: readableStream, info } = created;

            // File stream: optional auto-resolve to File/Blob
            if (info.type === StreamTypeConstant.FILE) {
              const fileStream = readableStream as IframeFileReadableStream;
              if (info.autoResolve) {
                autoResolveIframeFileReadableStream({ fileStream, info, headers: data.headers })
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
              .then((response) => {
                resolve(returnData ? response.data : response);
              })
              .catch(reject);
            return;
          }

          // Received response
          if (data.type === MessageType.RESPONSE) {
            done = true;
            cleanup();

            // Remember server's creatorId as target server ID for future requests
            this.rememberTargetServerId(data.creatorId);

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
            this.rememberTargetServerId(data.creatorId);

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
        this.targetOrigin,
        this.originValidator
      );

      // Set ACK timeout (delivery stage). If disabled, start request timeout immediately.
      if (requireAck === false) {
        setRequestTimeout();
      } else {
        setAckTimeout();
      }

      // Get cookies matching request path and merge with user-provided cookies (user-provided takes precedence)
      const pathMatchedCookies = this._cookieStore.getForPath(requestPath);
      const mergedCookies = { ...pathMatchedCookies, ...processedCookies };

      // Send request via MessageDispatcher
      const payload: Record<string, any> = {
        path: requestPath,
        body,
        headers: mergedHeaders,
        cookies: mergedCookies,
        targetId,
        requireAck,
        ack
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

      this.outbox.sendMessage(MessageType.REQUEST, requestId, payload);
    });
  }
  /**
   * Get internal hub instance (for debugging)
   */
  public getHub(): RequestIframeEndpointHub {
    return this.hub;
  }

  /**
   * Whether message handling is enabled
   */
  public get isOpen(): boolean {
    return this.hub.isOpen;
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
    this.hub.open();
  }

  /**
   * Disable message handling (unregister message handlers, but don't release resources)
   */
  public close(): void {
    this.hub.close();
  }

  /**
   * Destroy client (close and release all resources)
   */
  public destroy(): void {
    // Clear cookies
    this._cookieStore.clear();
    
    // Clear stream handlers
    this.streamDispatcher.clear();
    
    // Clear interceptors
    this.interceptors.request.clear();
    this.interceptors.response.clear();
    
    // Destroy core (this will also release the message channel)
    this.hub.destroy();
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
