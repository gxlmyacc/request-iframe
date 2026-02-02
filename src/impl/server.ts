import type {
  PostMessageData,
  ServerHandler,
  RequestIframeServer,
  Middleware,
  PathMatcher,
  OriginMatcher,
  OriginValidator
} from '../types';
import { matchPath, matchPathWithParams } from '../utils/path-match';
import { ServerRequestImpl } from './request';
import { ServerResponseImpl } from './response';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { generateInstanceId } from '../utils/id';
import {
  RequestIframeEndpointHub,
  RequestIframeEndpointFacade,
  buildStreamStartTimeoutErrorPayload,
  autoResolveIframeFileReadableStream,
} from '../endpoint';
import {
  MessageType,
  ErrorCode,
  HttpStatus,
  HttpStatusText,
  Messages,
  formatMessage,
  DefaultTimeout,
  ProtocolVersion,
  MessageRole,
  StreamType as StreamTypeConstant
} from '../constants';
import { isPromise } from '../utils/promise';
import { isFunction } from '../utils/is';
import { StreamMessageData } from '../stream';
import { warnServerIgnoredMessageWhenClosedOnce } from '../utils/warnings';

/**
 * Middleware item (contains path matcher and middleware function)
 */
interface MiddlewareItem {
  matcher: PathMatcher | null;
  middleware: Middleware;
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
  /** Advanced: auto-ack echo limit for ack.meta length (internal). */
  autoAckMaxMetaLength?: number;
  /** Advanced: auto-ack echo limit for ack.id length (internal). */
  autoAckMaxIdLength?: number;
}

/**
 * RequestIframeServer implementation
 * Uses shared MessageDispatcher (backed by MessageChannel) to listen for and send messages
 */
export class RequestIframeServerImpl implements RequestIframeServer {
  private static readonly PENDING_ACKS = 'server:pendingAcks';
  private static readonly PENDING_PONGS = 'server:pendingPongs';
  private static readonly PENDING_STREAM_REQUESTS = 'server:pendingStreamRequests';
  private static readonly LIMIT_IN_FLIGHT_BY_CLIENT = 'server:inFlightByClientKey';

  /** Unique instance ID */
  public readonly id: string;

  private readonly endpoint: RequestIframeEndpointFacade;
  private readonly hub: RequestIframeEndpointHub;
  private readonly ackTimeout: number;
  private readonly handlers = new Map<string, ServerHandler>();
  private readonly middlewares: MiddlewareItem[] = [];
  private readonly originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean;
  private readonly maxConcurrentRequestsPerClient: number;

  public constructor(options?: ServerOptions) {
    /** Use custom id if provided, otherwise generate one */
    this.id = options?.id || generateInstanceId();
    const endpoint = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: this.id,
      secretKey: options?.secretKey,
      versionValidator: options?.versionValidator,
      autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
      autoAckMaxIdLength: options?.autoAckMaxIdLength,
        streamDispatcher: { handledBy: this.id },
      heartbeat: {
        pendingBucket: RequestIframeServerImpl.PENDING_PONGS,
        handledBy: this.id,
        isOriginAllowed: (d, ctx) => this.isOriginAllowed(d, ctx),
        warnMissingPendingWhenClosed: (d) => {
          warnServerIgnoredMessageWhenClosedOnce(this.hub, { type: d.type, requestId: d.requestId });
        }
      },
      originValidator: {
        allowedOrigins: options?.allowedOrigins,
        validateOrigin: options?.validateOrigin
      }
    });

    this.endpoint = endpoint;
    this.hub = endpoint.hub;
    this.originValidator = endpoint.originValidator;

    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.maxConcurrentRequestsPerClient = options?.maxConcurrentRequestsPerClient ?? Number.POSITIVE_INFINITY;

    const warnMissingPendingWhenClosed = (d: PostMessageData) => {
      warnServerIgnoredMessageWhenClosedOnce(this.hub, { type: d.type, requestId: d.requestId });
    };

    const handlerOptions = this.hub.createHandlerOptions(this.handleVersionError.bind(this));

    // Server business entry: REQUEST handler
    this.endpoint.onOpen(() => {
      this.hub.registerHandler(MessageType.REQUEST, (data, context) => this.handleRequest(data, context), handlerOptions);
    });

    // Server base infra: ping/pong/ack/stream handlers (facade-managed)
    this.endpoint.registerServerBaseHandlers({
      handlerOptions,
      handledBy: this.id,
      includeTargetIdInPong: false,
      isOriginAllowed: (d, ctx) => this.isOriginAllowed(d, ctx),
      warnMissingPendingWhenClosed,
      pendingAckBucket: RequestIframeServerImpl.PENDING_ACKS,
      pendingStreamStartBucket: RequestIframeServerImpl.PENDING_STREAM_REQUESTS,
      expectedStreamStartRole: MessageRole.CLIENT
    });
    
    /** Auto-open by default (unless explicitly set to false) */
    if (options?.autoOpen !== false) {
      this.open();
    }
  }

  private get dispatcher(): MessageDispatcher {
    return this.hub.messageDispatcher;
  }

  /** Message isolation key (read-only) */
  public get secretKey(): string | undefined {
    return this.hub.secretKey;
  }

  /** Whether message handling is enabled */
  public get isOpen(): boolean {
    return this.hub.isOpen;
  }

  /** Enable message handling (register message handler) */
  public open(): void {
    this.hub.open();
  }

  /** Disable message handling (unregister message handler, but don't release resources) */
  public close(): void {
    this.hub.close();
  }

  /** Get the underlying MessageDispatcher */
  public get messageDispatcher(): MessageDispatcher {
    return this.hub.messageDispatcher;
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
      context.markHandledBy(this.id);
      
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
    const acquired = this.hub.limiter.tryAcquire(
      RequestIframeServerImpl.LIMIT_IN_FLIGHT_BY_CLIENT,
      clientKey,
      this.maxConcurrentRequestsPerClient
    );
    if (!acquired) {
      // Prevent other server instances from also responding
      context.markHandledBy(this.id);
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
          ack: (data as any).ack,
          targetId: data.creatorId
        }
      );
      return;
    }

    // Mark as accepted so MessageDispatcher can auto-send ACK (delivery confirmation)
    context.markAcceptedBy(this.id);

    // Create response object with channel reference
    // Pass request's creatorId as targetId so responses are routed back to the correct client
    const peer = this.hub.createOutbox(targetWindow, targetOrigin, data.creatorId);
    const res = new ServerResponseImpl(
      data.requestId,
      data.path || '',
      this.id,
      peer,
      {
        registerStreamHandler: (streamId: string, handler: (d: StreamMessageData) => void) => {
            this.endpoint.streamDispatcher.register(streamId, handler);
        },
        unregisterStreamHandler: (streamId: string) => {
            this.endpoint.streamDispatcher.unregister(streamId);
        },
        heartbeat: () => this.endpoint.pingPeer(targetWindow, targetOrigin, this.ackTimeout, data.creatorId),
        onSent: () => this.hub.limiter.release(RequestIframeServerImpl.LIMIT_IN_FLIGHT_BY_CLIENT, clientKey)
      }
    );

    // Register callback waiting for client acknowledgment
    this.endpoint.registerPendingAck({
      requestId: data.requestId,
      timeoutMs: this.ackTimeout,
      pendingBucket: RequestIframeServerImpl.PENDING_ACKS,
      resolve: (received: boolean, ack?: any) => {
        res._triggerAck(received, ack);
      }
    });

    // Client sends body as stream: wait for stream_start, then create readable stream and call handler
    // If streamId is present, this is a stream request
    const streamId = (data as any).streamId as string | undefined;
    if (streamId) {
      const streamStartTimeout = this.ackTimeout;
      this.endpoint.registerIncomingStreamStartWaiter({
        pendingBucket: RequestIframeServerImpl.PENDING_STREAM_REQUESTS,
        requestId: data.requestId,
        streamId,
        timeoutMs: streamStartTimeout,
        targetWindow,
        targetOrigin,
        onTimeout: () => {
          if (!res._sent) {
            res._markSent();
            this.dispatcher.sendMessage(
              targetWindow,
              targetOrigin,
              MessageType.ERROR,
              data.requestId,
              buildStreamStartTimeoutErrorPayload({
                path: data.path || '',
                timeoutMs: streamStartTimeout,
                requireAck: data.requireAck,
                ack: (data as any).ack,
                targetId: data.creatorId
              })
            );
          }
        },
        continue: ({ stream, info, data: streamStartData }) => {
          // Create request object with path parameters
          const req = new ServerRequestImpl(data, context, res, params);

          // File stream: optionally auto-resolve to File/Blob before calling handler
          if (info?.type === StreamTypeConstant.FILE) {
            const fileStream = stream as any;
            if (info?.autoResolve) {
              autoResolveIframeFileReadableStream({ fileStream, info })
                .then((fileData: File | Blob) => {
                  req.body = fileData;
                  req.stream = undefined;
                  this.runMiddlewares(req, res, () => {
                    try {
                      const result = handlerFn(req, res);
                      if (isPromise(result)) {
                        this.dispatcher.sendMessage(
                          targetWindow,
                          targetOrigin,
                          MessageType.ASYNC,
                          streamStartData.requestId,
                          { path: data.path, targetId: streamStartData.creatorId }
                        );
                        result
                          .then(this.handleRequestResult.bind(this, res, targetWindow, targetOrigin, data))
                          .catch(this.handleRequestError.bind(this, res, targetWindow, targetOrigin, data));
                      } else {
                        this.handleRequestResult(res, targetWindow, targetOrigin, data, result);
                      }
                    } catch (error) {
                      this.handleRequestError(res, targetWindow, targetOrigin, data, error);
                    }
                  });
                })
                .catch((error: any) => {
                  this.handleRequestError(res, targetWindow, targetOrigin, data, error);
                });
              return;
            }

            // Non-autoResolve: expose stream directly
            req.body = fileStream as any;
            req.stream = fileStream as any;
          } else {
            // Non-file stream
            req.body = undefined;
            req.stream = stream as any;
          }

          this.runMiddlewares(req, res, () => {
            try {
              const result = handlerFn(req, res);
              if (isPromise(result)) {
                this.dispatcher.sendMessage(
                  targetWindow,
                  targetOrigin,
                  MessageType.ASYNC,
                  streamStartData.requestId,
                  { path: data.path, targetId: streamStartData.creatorId }
                );
                result
                  .then(this.handleRequestResult.bind(this, res, targetWindow, targetOrigin, data))
                  .catch(this.handleRequestError.bind(this, res, targetWindow, targetOrigin, data));
              } else {
                this.handleRequestResult(res, targetWindow, targetOrigin, data, result);
              }
            } catch (error) {
              this.handleRequestError(res, targetWindow, targetOrigin, data, error);
            }
          });
        }
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

  public use(middleware: Middleware): void;
  public use(path: PathMatcher, middleware: Middleware): void;
  public use(pathOrMiddleware: PathMatcher | Middleware, middleware?: Middleware): void {
    if (isFunction(pathOrMiddleware)) {
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
   * Cleanup before destroy
   */
  private cleanup(): void {
    // Clean up handlers
    this.handlers.clear();
    this.middlewares.length = 0;
    this.endpoint.streamDispatcher.clear();
  }

  /**
   * Destroy server (close and release resources)
   */
  public destroy(): void {
    this.cleanup();
    this.hub.destroy();
  }
}
