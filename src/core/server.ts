import {
  PostMessageData,
  ServerHandler,
  RequestIframeServer,
  Middleware,
  PathMatcher
} from '../types';
import { isCompatibleVersion } from '../utils';
import { matchPath } from '../utils/path-match';
import { ServerRequestImpl } from './request';
import { ServerResponseImpl } from './response';
import { MessageDispatcher, VersionValidator, MessageContext } from '../message';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../utils/cache';
import {
  MessageType,
  ErrorCode,
  HttpStatus,
  HttpStatusText,
  Messages,
  DefaultTimeout,
  ProtocolVersion,
  formatMessage
} from '../constants';

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
  resolve: (received: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Server configuration options
 */
export interface ServerOptions {
  /** Message isolation secret key */
  secretKey?: string;
  /** ACK timeout duration */
  ackTimeout?: number;
  /** Protocol version validator (optional, uses built-in validator by default) */
  versionValidator?: VersionValidator;
}

/**
 * RequestIframeServer implementation
 * Uses shared MessageDispatcher (backed by MessageChannel) to listen for and send messages
 */
export class RequestIframeServerImpl implements RequestIframeServer {
  private readonly dispatcher: MessageDispatcher;
  private readonly ackTimeout: number;
  private readonly versionValidator: VersionValidator;
  private readonly handlers = new Map<string, ServerHandler>();
  private readonly middlewares: MiddlewareItem[] = [];
  
  /** Responses waiting for client acknowledgment */
  private readonly pendingAcks = new Map<string, PendingAck>();
  
  /** List of functions to unregister handlers */
  private readonly unregisterFns: Array<() => void> = [];
  
  /** Whether it is open */
  private _isOpen = false;

  public constructor(options?: ServerOptions) {
    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.SERVER_ACK;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel);
    
    // Auto-open by default
    this.open();
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

    // Handle RECEIVED messages (for confirming response delivery)
    this.unregisterFns.push(
      this.dispatcher.registerHandler(
        MessageType.RECEIVED,
        (data) => this.handleReceived(data),
        handlerOptions
      )
    );
  }

  /**
   * Handle protocol version error
   */
  private handleVersionError(data: PostMessageData, context: MessageContext, version: number): void {
    if (!context.source) return;

    // Send protocol version incompatibility error
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
    this.dispatcher.sendMessage(
      context.source,
      context.origin,
      MessageType.PONG,
      data.requestId
    );
  }

  /**
   * Handle received acknowledgment
   */
  private handleReceived(data: PostMessageData): void {
    const pending = this.pendingAcks.get(data.requestId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingAcks.delete(data.requestId);
      pending.resolve(true);
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

  /**
   * Handle request
   */
  private handleRequest(data: PostMessageData, context: MessageContext): void {
    if (!data.path) return;
    if (!context.source) return;

    const targetWindow = context.source;
    const targetOrigin = context.origin;

    // Send ACK immediately via dispatcher
    this.dispatcher.sendMessage(
      targetWindow,
      targetOrigin,
      MessageType.ACK,
      data.requestId,
      { path: data.path }
    );

    const handlerFn = this.handlers.get(data.path);
    if (!handlerFn) {
      this.dispatcher.sendMessage(
        targetWindow,
        targetOrigin,
        MessageType.ERROR,
        data.requestId,
        {
          path: data.path,
          error: { message: Messages.METHOD_NOT_FOUND, code: ErrorCode.METHOD_NOT_FOUND },
          status: HttpStatus.NOT_FOUND,
          statusText: HttpStatusText[HttpStatus.NOT_FOUND]
        }
      );
      return;
    }

    // Create response object with channel reference
    const res = new ServerResponseImpl(
      data.requestId,
      data.path || '',
      data.secretKey,
      targetWindow,
      targetOrigin,
      this.dispatcher.getChannel()
    );

    // Register callback waiting for client acknowledgment
    this.registerPendingAck(
      data.requestId,
      (received: boolean) => {
        res._triggerAck(received);
      },
      () => {
        res._triggerAck(false);
      }
    );

    // Create request object
    const req = new ServerRequestImpl(data, context, res);

    // Execute middleware chain
    this.runMiddlewares(req, res, () => {
      const result = handlerFn(req, res);

      if (result instanceof Promise) {
        // Async task
        this.dispatcher.sendMessage(
          targetWindow,
          targetOrigin,
          MessageType.ASYNC,
          data.requestId,
          { path: data.path }
        );

        result
          .then((value) => {
            if (!res._sent && value !== undefined) {
              res.send(value);
            } else if (!res._sent) {
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
          })
          .catch((err) => {
            if (!res._sent) {
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
                  status: res.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
                  statusText: HttpStatusText[HttpStatus.INTERNAL_SERVER_ERROR],
                  headers: res.headers
                }
              );
            }
          });
      } else {
        // Synchronous processing
        if (!res._sent && result !== undefined) {
          res.send(result);
        }
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

  public on(path: string, handler: ServerHandler): void {
    this.handlers.set(this.dispatcher.prefixPath(path), handler);
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

  public off(path: string): void {
    this.handlers.delete(this.dispatcher.prefixPath(path));
  }

  public map(handlers: Record<string, ServerHandler>): void {
    Object.entries(handlers).forEach(([path, h]) => {
      this.on(path, h);
    });
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
    
    // Clean up handlers
    this.handlers.clear();
    this.middlewares.length = 0;
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
