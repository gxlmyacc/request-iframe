import type {
  PostMessageData,
  ServerHandler,
  RequestIframeServer,
  Middleware,
  PathMatcher,
  OriginMatcher,
  OriginValidator
} from '../types';
import { isCompatibleVersion } from '../utils';
import { matchPath, matchPathWithParams } from '../utils/path-match';
import { matchOrigin } from '../utils/origin';
import { ServerRequestImpl } from './request';
import { ServerResponseImpl } from './response';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../utils/cache';
import { generateInstanceId, generateRequestId } from '../utils';
import {
  MessageType,
  ErrorCode,
  HttpStatus,
  HttpStatusText,
  Messages,
  DefaultTimeout,
  ProtocolVersion,
  formatMessage,
  MessageRole,
  StreamType as StreamTypeConstant
} from '../constants';
import { isPromise } from '../utils';
import { IframeReadableStream, IframeFileReadableStream, StreamMessageHandler, StreamMessageData } from '../stream';

/**
 * Middleware item (contains path matcher and middleware function)
 */
interface MiddlewareItem {
  matcher: PathMatcher | null;
  middleware: Middleware;
}

/**
 * Pending acknowledgment
 */
interface PendingAck {
  resolve: (received: boolean, ackMeta?: any) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingPong {
  resolve: (ok: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** Pending request waiting for client stream (streamId present) */
interface PendingStreamRequest {
  path: string;
  requestId: string;
  streamId: string;
  timeoutId: ReturnType<typeof setTimeout>;
  handlerFn: ServerHandler;
  targetWindow: Window;
  targetOrigin: string;
  res: ServerResponseImpl;
  data: PostMessageData;
  context: MessageContext;
  params: Record<string, string>;
}

/**
 * Server configuration options
 */
export interface ServerOptions {
  /** Message isolation secret key */
  secretKey?: string;
  /** Custom server instance ID (if specified, server will use this ID instead of generating one) */
  id?: string;
  /** ACK timeout duration */
  ackTimeout?: number;
  /** Protocol version validator (optional, uses built-in validator by default) */
  versionValidator?: VersionValidator;
  /** Allowed origins for incoming messages */
  allowedOrigins?: OriginMatcher;
  /** Custom origin validator (higher priority than allowedOrigins) */
  validateOrigin?: OriginValidator;
  /** Whether to automatically open when creating the server. Default is true. */
  autoOpen?: boolean;
  /**
   * Max concurrent in-flight requests per client (per origin + creatorId).
   * Used to mitigate message explosion caused by abnormal code or attacks.
   */
  maxConcurrentRequestsPerClient?: number;
}

/**
 * RequestIframeServer implementation
 * Uses shared MessageDispatcher (backed by MessageChannel) to listen for and send messages
 */
export class RequestIframeServerImpl implements RequestIframeServer {
  /** Unique instance ID */
  public readonly id: string;

  private readonly dispatcher: MessageDispatcher;
  private readonly ackTimeout: number;
  private readonly versionValidator: VersionValidator;
  private readonly handlers = new Map<string, ServerHandler>();
  private readonly middlewares: MiddlewareItem[] = [];
  private readonly originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean;
  private readonly maxConcurrentRequestsPerClient: number;
  private readonly inFlightByClientKey = new Map<string, number>();
  
  /** Responses waiting for client acknowledgment */
  private readonly pendingAcks = new Map<string, PendingAck>();
  /** Pending pings waiting for client PONG (server -> client heartbeat) */
  private readonly pendingPongs = new Map<string, PendingPong>();

  /** Pending requests waiting for client stream_start (streamId present) */
  private readonly pendingStreamRequests = new Map<string, PendingStreamRequest>();

  /** Stream message handlers (streamId -> handler) for client→server streams */
  private readonly streamHandlers = new Map<string, (data: StreamMessageData) => void>();
  
  /** List of functions to unregister handlers */
  private readonly unregisterFns: Array<() => void> = [];
  
  /** Whether it is open */
  private _isOpen = false;

  public constructor(options?: ServerOptions) {
    // Use custom id if provided, otherwise generate one
    this.id = options?.id || generateInstanceId();
    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    this.maxConcurrentRequestsPerClient = options?.maxConcurrentRequestsPerClient ?? Number.POSITIVE_INFINITY;

    // Build origin validator (incoming messages)
    if (options?.validateOrigin) {
      this.originValidator = (origin, data, context) => options.validateOrigin!(origin, data, context);
    } else if (options?.allowedOrigins) {
      const matcher = options.allowedOrigins;
      this.originValidator = (origin) => matchOrigin(origin, matcher);
    }
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel, MessageRole.SERVER, this.id);
    
    // Auto-open by default (unless explicitly set to false)
    if (options?.autoOpen !== false) {
      this.open();
    }
  }

  /**
   * Check whether an incoming message origin is allowed.
   */
  private isOriginAllowed(data: PostMessageData, context: MessageContext): boolean {
    if (!this.originValidator) return true;
    try {
      return this.originValidator(context.origin, data, context);
    } catch {
      return false;
    }
  }

  /**
   * Build a per-client key used for concurrency limiting.
   * We intentionally include origin to prevent cross-origin collisions.
   */
  private getClientKey(origin: string, creatorId?: string): string {
    return `${origin}::${creatorId || 'unknown'}`;
  }

  private incInFlight(clientKey: string): void {
    const current = this.inFlightByClientKey.get(clientKey) || 0;
    this.inFlightByClientKey.set(clientKey, current + 1);
  }

  private decInFlight(clientKey: string): void {
    const current = this.inFlightByClientKey.get(clientKey) || 0;
    const next = current - 1;
    if (next <= 0) {
      this.inFlightByClientKey.delete(clientKey);
      return;
    }
    this.inFlightByClientKey.set(clientKey, next);
  }

  /**
   * Open message processing (register message handlers)
   */
  public open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.registerHandlers();
  }

  /**
   * Close message processing (unregister message handlers, but don't release channel)
   */
  public close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    
    // Unregister all handlers
    this.unregisterFns.forEach(fn => fn());
    this.unregisterFns.length = 0;
  }

  /**
   * Whether it is open
   */
  public get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Register message handlers
   */
  private registerHandlers(): void {
    const handlerOptions = {
      versionValidator: this.versionValidator,
      onVersionError: this.handleVersionError.bind(this)
    };

    // Handle REQUEST messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.REQUEST,
        (data, context) => this.handleRequest(data, context),
        handlerOptions
      )
    );

    // Handle PING messages
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.PING,
        (data, context) => this.handlePing(data, context),
        handlerOptions
      )
    );

    // Handle PONG messages (server -> client heartbeat)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.PONG,
        (data, context) => this.handlePong(data, context),
        handlerOptions
      )
    );

    // Handle RECEIVED messages (for confirming response delivery)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RECEIVED,
        (data, context) => this.handleReceived(data, context),
        handlerOptions
      )
    );

    // Handle stream_* messages (client→server stream)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.STREAM_START,
        (data, ctx) => this.handleStreamStart(data, ctx),
        handlerOptions
      )
    );
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        (type: string) => type.startsWith('stream_') && type !== MessageType.STREAM_START,
        (data, context) => this.dispatchStreamMessage(data, context),
        handlerOptions
      )
    );
  }

  /** Handle stream_start from client (stream request with streamId) */
  private handleStreamStart(data: PostMessageData, context: MessageContext): void {
    if (data.role !== MessageRole.CLIENT) return;
    if (!this.isOriginAllowed(data, context)) return;
    const body = data.body as StreamMessageData;
    if (!body?.streamId) return;
    const pending = this.pendingStreamRequests.get(data.requestId);
    if (!pending || pending.streamId !== body.streamId) return;

    clearTimeout(pending.timeoutId);
    this.pendingStreamRequests.delete(data.requestId);

    const { targetWindow, targetOrigin, res, data: reqData, context: reqContext, handlerFn } = pending;

    const streamHandler: StreamMessageHandler = {
      registerStreamHandler: (streamId: string, handler: (d: StreamMessageData) => void) => {
        this.streamHandlers.set(streamId, handler);
      },
      unregisterStreamHandler: (streamId: string) => {
        this.streamHandlers.delete(streamId);
      },
      postMessage: (message: any) => {
        this.dispatcher.send(targetWindow, message, targetOrigin);
      }
    };

    const streamType = body.type || StreamTypeConstant.DATA;
    const streamMode = body.mode;
    const streamChunked = body.chunked ?? true;
    const streamMetadata = body.metadata;

    const req = new ServerRequestImpl(reqData, reqContext, res, pending.params);

    // File stream: optionally auto-resolve to File/Blob before calling handler
    if (streamType === StreamTypeConstant.FILE) {
      const fileStream = new IframeFileReadableStream(body.streamId, data.requestId, streamHandler, {
        chunked: streamChunked,
        metadata: streamMetadata,
        secretKey: data.secretKey,
        mode: streamMode,
        filename: streamMetadata?.filename,
        mimeType: streamMetadata?.mimeType,
        size: streamMetadata?.size
      });

      const autoResolve = body.autoResolve ?? false;
      if (autoResolve) {
        const name = fileStream.filename || streamMetadata?.filename;
        const promise = name ? fileStream.readAsFile(name) : fileStream.readAsBlob();
        promise
          .then((fileData: File | Blob) => {
            req.body = fileData;
            req.stream = undefined;
            this.runMiddlewares(req, res, () => {
              try {
                const result = handlerFn(req, res);
                if (isPromise(result)) {
                  // Window check is handled in MessageDispatcher
                  this.dispatcher.sendMessage(
                    targetWindow,
                    targetOrigin,
                    MessageType.ASYNC,
                    data.requestId,
                    { path: reqData.path, targetId: data.creatorId }
                  );
                  result
                    .then(this.handleRequestResult.bind(this, res, targetWindow, targetOrigin, reqData))
                    .catch(this.handleRequestError.bind(this, res, targetWindow, targetOrigin, reqData));
                } else {
                  this.handleRequestResult(res, targetWindow, targetOrigin, reqData, result);
                }
              } catch (error) {
                this.handleRequestError(res, targetWindow, targetOrigin, reqData, error);
              }
            });
          })
          .catch((error) => {
            this.handleRequestError(res, targetWindow, targetOrigin, reqData, error);
          });
        return;
      }

      // Non-autoResolve: expose stream directly
      req.body = fileStream as any;
      req.stream = fileStream as any;
    } else {
      // Non-file stream
      const readableStream = new IframeReadableStream(body.streamId, data.requestId, streamHandler, {
        type: streamType,
        mode: streamMode,
        chunked: streamChunked,
        metadata: streamMetadata,
        secretKey: data.secretKey
      });
      req.body = undefined;
      req.stream = readableStream;
    }

    this.runMiddlewares(req, res, () => {
      try {
        const result = handlerFn(req, res);
        if (isPromise(result)) {
          // Window check is handled in MessageDispatcher
          this.dispatcher.sendMessage(
            targetWindow,
            targetOrigin,
            MessageType.ASYNC,
            data.requestId,
            { path: reqData.path, targetId: data.creatorId }
          );
          result
            .then(this.handleRequestResult.bind(this, res, targetWindow, targetOrigin, reqData))
            .catch(this.handleRequestError.bind(this, res, targetWindow, targetOrigin, reqData));
        } else {
          this.handleRequestResult(res, targetWindow, targetOrigin, reqData, result);
        }
      } catch (error) {
        this.handleRequestError(res, targetWindow, targetOrigin, reqData, error);
      }
    });
  }

  private dispatchStreamMessage(data: PostMessageData, context: MessageContext): void {
    if (!this.isOriginAllowed(data, context)) return;
    const body = data.body as StreamMessageData;
    if (!body?.streamId) return;
    const handler = this.streamHandlers.get(body.streamId);
    if (handler) {
      const messageType = (data.type as string).replace('stream_', '');
      handler({ ...body, type: messageType as any });
    }
  }

  /**
   * Handle protocol version error
   */
  private handleVersionError(data: PostMessageData, context: MessageContext, version: number): void {
    if (!context.source) return;

    // Send protocol version incompatibility error
    // Window check is handled in MessageDispatcher
    this.dispatcher.sendMessage(
      context.source,
      context.origin,
      MessageType.ERROR,
      data.requestId,
      {
        path: data.path,
        status: HttpStatus.BAD_REQUEST,
        statusText: Messages.PROTOCOL_VERSION_UNSUPPORTED,
        error: {
          message: formatMessage(Messages.PROTOCOL_VERSION_TOO_LOW, version, ProtocolVersion.MIN_SUPPORTED),
          code: ErrorCode.PROTOCOL_UNSUPPORTED
        }
      }
    );
  }

  /**
   * Handle ping message
   */
  private handlePing(data: PostMessageData, context: MessageContext): void {
    if (!context.source) return;
    if (!this.isOriginAllowed(data, context)) return;

    /**
     * Only allow one server instance to respond.
     * This is important when multiple server instances share the same channel.
     */
    if (!context.handledBy) {
      // Mark as accepted so MessageDispatcher can auto-send ACK when requireAck === true
      context.accepted = true;
      context.handledBy = this.id;
    }

    // Window check is handled in MessageDispatcher
    this.dispatcher.sendMessage(
      context.source,
      context.origin,
      MessageType.PONG,
      data.requestId
    );
  }

  private handlePong(data: PostMessageData, context: MessageContext): void {
    if (!this.isOriginAllowed(data, context)) return;
    const pending = this.pendingPongs.get(data.requestId);
    if (pending) {
      if (!context.handledBy) {
        context.accepted = true;
        context.handledBy = this.id;
      }
      clearTimeout(pending.timeoutId);
      this.pendingPongs.delete(data.requestId);
      pending.resolve(true);
    }
  }

  private pingClient(targetWindow: Window, targetOrigin: string, targetClientId?: string): Promise<boolean> {
    const requestId = generateRequestId();
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingPongs.delete(requestId);
        resolve(false);
      }, this.ackTimeout);
      this.pendingPongs.set(requestId, { resolve, timeoutId });
      // Window check is handled in MessageDispatcher
      this.dispatcher.sendMessage(
        targetWindow,
        targetOrigin,
        MessageType.PING,
        requestId,
        {
          requireAck: true,
          targetId: targetClientId
        }
      );
    });
  }

  /**
   * Handle received acknowledgment
   */
  private handleReceived(data: PostMessageData, context: MessageContext): void {
    if (!this.isOriginAllowed(data, context)) return;
    const pending = this.pendingAcks.get(data.requestId);
    if (pending) {
      // Best-effort: prevent other server instances from also resolving
      if (!context.handledBy) {
        context.handledBy = this.id;
      }
      clearTimeout(pending.timeoutId);
      this.pendingAcks.delete(data.requestId);
      pending.resolve(true, (data as any).ackMeta);
    }
  }

  /** Get secretKey */
  public get secretKey(): string | undefined {
    return this.dispatcher.secretKey;
  }

  /** Get the underlying MessageDispatcher */
  public get messageDispatcher(): MessageDispatcher {
    return this.dispatcher;
  }

  private handleRequestError(res: ServerResponseImpl, 
    targetWindow: Window,
    targetOrigin: string, 
    data: PostMessageData,
    err: any
  ) {
    if (!res._sent) {
      res._markSent();
      /** 
       * Use INTERNAL_SERVER_ERROR (500) for handler errors unless a different error status code was explicitly set.
       * If statusCode is still the default OK (200), override it to INTERNAL_SERVER_ERROR.
       */
      const errorStatus = res.statusCode === HttpStatus.OK 
        ? HttpStatus.INTERNAL_SERVER_ERROR 
        : res.statusCode;
      
      // Window check is handled in MessageDispatcher
      this.dispatcher.sendMessage(
        targetWindow,
        targetOrigin,
        MessageType.ERROR,
        data.requestId,
        {
          path: data.path,
          error: {
            message: (err && err.message) || Messages.REQUEST_FAILED,
            code: (err && err.code) || ErrorCode.REQUEST_ERROR
          },
          status: errorStatus,
          statusText: HttpStatusText[errorStatus] || HttpStatusText[HttpStatus.INTERNAL_SERVER_ERROR],
          headers: res.headers,
          targetId: data.creatorId
        }
      );
    }
  }

  private handleRequestResult(res: ServerResponseImpl, 
    targetWindow: Window,
    targetOrigin: string, 
    data: PostMessageData,
    result: any,
  ) {
    if (!res._sent && result !== undefined) {
      res.send(result);
    } else if (!res._sent) {
      res._markSent();
      this.dispatcher.sendMessage(
        targetWindow,
        targetOrigin,
        MessageType.ERROR,
        data.requestId,
        {
          path: data.path,
          error: {
            message: Messages.NO_RESPONSE_SENT,
            code: ErrorCode.NO_RESPONSE
          },
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: HttpStatusText[HttpStatus.INTERNAL_SERVER_ERROR],
          headers: res.headers
        }
      );
    }
  }

  /**
   * Find matching handler and extract path parameters
   * @param requestPath The actual request path
   * @returns Handler function and extracted parameters, or null if not found
   */
  private findHandler(requestPath: string): { handler: ServerHandler; params: Record<string, string> } | null {
    const prefixedRequestPath = this.dispatcher.prefixPath(requestPath);

    // First try exact match (for backward compatibility and performance)
    const exactHandler = this.handlers.get(prefixedRequestPath);
    if (exactHandler) {
      return { handler: exactHandler, params: {} };
    }

    // Then try parameter matching (e.g., '/api/users/:id' matches '/api/users/123')
    for (const [registeredPath, handler] of this.handlers.entries()) {
      // Check if registered path contains parameters
      if (registeredPath.includes(':')) {
        const matchResult = matchPathWithParams(prefixedRequestPath, registeredPath);
        if (matchResult.match) {
          return { handler, params: matchResult.params };
        }
      }
    }

    return null;
  }

  /**
   * Handle request
   */
  private handleRequest(data: PostMessageData, context: MessageContext): void {
    // If targetId is specified, only process if it matches this server's id
    if (!data.path || (data.targetId && data.targetId !== this.id)) return;
    if (!context.source) return;
    if (!this.isOriginAllowed(data, context)) return;

    // If message has already been handled by another server instance, skip processing
    if (context.handledBy) {
      return;
    }

    const targetWindow = context.source;
    const targetOrigin = context.origin;

    // Find matching handler and extract path parameters
    const handlerMatch = this.findHandler(data.path);
    if (!handlerMatch) {
      // No handler found in this instance
      // Mark as handled by this instance (using special marker) to prevent other instances from processing
      // This ensures only one instance sends the error response
      context.handledBy = this.id;
      
      // Send METHOD_NOT_FOUND error
      // Use request's creatorId as targetId to route back to the correct client
      // Window check is handled in MessageDispatcher
      this.dispatcher.sendMessage(
        targetWindow,
        targetOrigin,
        MessageType.ERROR,
        data.requestId,
        {
          path: data.path,
          error: { message: Messages.METHOD_NOT_FOUND, code: ErrorCode.METHOD_NOT_FOUND },
          status: HttpStatus.NOT_FOUND,
          statusText: HttpStatusText[HttpStatus.NOT_FOUND],
          targetId: data.creatorId
        }
      );
      return;
    }

    const { handler: handlerFn, params } = handlerMatch;

    const clientKey = this.getClientKey(targetOrigin, data.creatorId);
    if (Number.isFinite(this.maxConcurrentRequestsPerClient)) {
      const inFlight = this.inFlightByClientKey.get(clientKey) || 0;
      if (inFlight >= this.maxConcurrentRequestsPerClient) {
        // Prevent other server instances from also responding
        context.handledBy = this.id;
        this.dispatcher.sendMessage(
          targetWindow,
          targetOrigin,
          MessageType.ERROR,
          data.requestId,
          {
            path: data.path,
            error: {
              message: formatMessage(Messages.TOO_MANY_REQUESTS, this.maxConcurrentRequestsPerClient),
              code: ErrorCode.TOO_MANY_REQUESTS
            },
            status: HttpStatus.TOO_MANY_REQUESTS,
            statusText: HttpStatusText[HttpStatus.TOO_MANY_REQUESTS],
            requireAck: data.requireAck,
            ackMeta: (data as any).ackMeta,
            targetId: data.creatorId
          }
        );
        return;
      }
    }

    this.incInFlight(clientKey);

    // Mark as accepted so MessageDispatcher can auto-send ACK (delivery confirmation)
    context.accepted = true;

    // Mark message as handled by this server instance to prevent other server instances from processing it
    context.handledBy = this.id;

    // Create response object with channel reference
    // Pass request's creatorId as targetId so responses are routed back to the correct client
    const res = new ServerResponseImpl(
      data.requestId,
      data.path || '',
      data.secretKey,
      targetWindow,
      targetOrigin,
      this.dispatcher.getChannel(),
      this.id,
      data.creatorId,
      {
        registerStreamHandler: (streamId: string, handler: (d: StreamMessageData) => void) => {
          this.streamHandlers.set(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
          this.streamHandlers.delete(streamId);
        },
        heartbeat: () => this.pingClient(targetWindow, targetOrigin, data.creatorId),
        onSent: () => this.decInFlight(clientKey)
      }
    );

    // Register callback waiting for client acknowledgment
    this.registerPendingAck(
      data.requestId,
      (received: boolean, ackMeta?: any) => {
        res._triggerAck(received, ackMeta);
      },
      () => {
        res._triggerAck(false);
      }
    );

    // Client sends body as stream: wait for stream_start, then create readable stream and call handler
    // If streamId is present, this is a stream request
    const streamId = (data as any).streamId as string | undefined;
    if (streamId) {
      const streamStartTimeout = this.ackTimeout;
      const timeoutId = setTimeout(() => {
        const pending = this.pendingStreamRequests.get(data.requestId);
        if (!pending) return;
        this.pendingStreamRequests.delete(data.requestId);
        if (!pending.res._sent) {
          pending.res._markSent();
          this.dispatcher.sendMessage(
            pending.targetWindow,
            pending.targetOrigin,
            MessageType.ERROR,
            pending.requestId,
            {
              path: pending.path,
              error: {
                message: formatMessage(Messages.STREAM_START_TIMEOUT, streamStartTimeout),
                code: ErrorCode.STREAM_START_TIMEOUT
              },
              status: HttpStatus.REQUEST_TIMEOUT,
              statusText: HttpStatusText[HttpStatus.REQUEST_TIMEOUT],
              requireAck: pending.data.requireAck,
              ackMeta: (pending.data as any).ackMeta,
              targetId: pending.data.creatorId
            }
          );
        }
      }, streamStartTimeout);

      this.pendingStreamRequests.set(data.requestId, {
        path: data.path || '',
        requestId: data.requestId,
        streamId,
        timeoutId,
        handlerFn,
        targetWindow,
        targetOrigin,
        res,
        data,
        context,
        params
      });
      return;
    }

    // Create request object with path parameters
    const req = new ServerRequestImpl(data, context, res, params);

    // Execute middleware chain
    this.runMiddlewares(req, res, () => {

      try {
        const result = handlerFn(req, res);

        if (isPromise(result)) {
          // Async task
          // Window check is handled in MessageDispatcher
          // Use request's creatorId as targetId to route back to the correct client
          this.dispatcher.sendMessage(
            targetWindow,
            targetOrigin,
            MessageType.ASYNC,
            data.requestId,
            { 
              path: data.path,
              targetId: data.creatorId
            }
          );

          result.then(
            this.handleRequestResult.bind(this, res, targetWindow, targetOrigin, data)
          ).catch(this.handleRequestError.bind(this, res, targetWindow, targetOrigin, data));
        } else {
          // Synchronous processing
          this.handleRequestResult(res, targetWindow, targetOrigin, data, result); 
        }
      } catch (error) {
        this.handleRequestError(res, targetWindow, targetOrigin, data, error);
      }
    });
  }

  /**
   * Register pending acknowledgment response
   */
  private registerPendingAck(
    requestId: string,
    resolve: (received: boolean) => void,
    reject: (error: Error) => void
  ): void {
    const timeoutId = setTimeout(() => {
      this.pendingAcks.delete(requestId);
      resolve(false);
    }, this.ackTimeout);

    this.pendingAcks.set(requestId, { resolve, reject, timeoutId });
  }

  public use(middleware: Middleware): void;
  public use(path: PathMatcher, middleware: Middleware): void;
  public use(pathOrMiddleware: PathMatcher | Middleware, middleware?: Middleware): void {
    if (typeof pathOrMiddleware === 'function') {
      this.middlewares.push({
        matcher: null,
        middleware: pathOrMiddleware
      });
    } else if (middleware) {
      this.middlewares.push({
        matcher: pathOrMiddleware,
        middleware
      });
    }
  }

  public on(path: string, handler: ServerHandler): () => void {
    const prefixedPath = this.dispatcher.prefixPath(path);
    this.handlers.set(prefixedPath, handler);
    
    // Return unregister function
    return () => {
      this.handlers.delete(prefixedPath);
    };
  }

  private runMiddlewares(
    req: ServerRequestImpl,
    res: ServerResponseImpl,
    finalHandler: () => void
  ): void {
    const path = req.path;
    let index = 0;

    const next = (): void => {
      if (res._sent) {
        return;
      }

      while (index < this.middlewares.length) {
        const item = this.middlewares[index++];
        
        if (item.matcher === null || matchPath(path, item.matcher)) {
          try {
            const result = item.middleware(req, res, next);
            if (result instanceof Promise) {
              result.catch((err) => {
                if (!res._sent) {
                  res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ error: err.message || Messages.MIDDLEWARE_ERROR });
                }
              });
            }
            return;
          } catch (err: any) {
            if (!res._sent) {
              res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ error: err?.message || Messages.MIDDLEWARE_ERROR });
            }
            return;
          }
        }
      }

      if (index >= this.middlewares.length) {
        finalHandler();
      }
    };

    next();
  }

  public off(path: string | string[]): void {
    if (Array.isArray(path)) {
      // Batch unregister
      path.forEach(p => {
        this.handlers.delete(this.dispatcher.prefixPath(p));
      });
    } else {
      // Single unregister
      this.handlers.delete(this.dispatcher.prefixPath(path));
    }
  }

  public map(handlers: Record<string, ServerHandler>): (() => void) {
    const unregisterFns: (() => void)[] = [];
    Object.entries(handlers).forEach(([path, h]) => {
      unregisterFns.push(this.on(path, h));
    });
    return () => {
      unregisterFns.forEach(fn => fn());
    };
  }

  /**
   * Destroy (close and release channel reference)
   */
  public destroy(): void {
    // Close first
    this.close();
    
    // Clean up pending
    this.pendingAcks.forEach((pending) => clearTimeout(pending.timeoutId));
    this.pendingAcks.clear();
    this.pendingPongs.forEach((pending) => clearTimeout(pending.timeoutId));
    this.pendingPongs.clear();
    this.pendingStreamRequests.forEach((pending) => clearTimeout(pending.timeoutId));
    this.pendingStreamRequests.clear();
    this.inFlightByClientKey.clear();
    
    // Clean up handlers
    this.handlers.clear();
    this.middlewares.length = 0;
    this.streamHandlers.clear();
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
