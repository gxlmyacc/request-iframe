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
import { generateInstanceId } from '../utils';
import {
  MessageType,
  ErrorCode,
  HttpStatus,
  HttpStatusText,
  Messages,
  DefaultTimeout,
  ProtocolVersion,
  formatMessage,
  MessageRole
} from '../constants';
import { isPromise } from '../utils';

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
  /** Custom server instance ID (if specified, server will use this ID instead of generating one) */
  id?: string;
  /** ACK timeout duration */
  ackTimeout?: number;
  /** Protocol version validator (optional, uses built-in validator by default) */
  versionValidator?: VersionValidator;
  /** Whether to automatically open when creating the server. Default is true. */
  autoOpen?: boolean;
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
  
  /** Responses waiting for client acknowledgment */
  private readonly pendingAcks = new Map<string, PendingAck>();
  
  /** List of functions to unregister handlers */
  private readonly unregisterFns: Array<() => void> = [];
  
  /** Whether it is open */
  private _isOpen = false;

  public constructor(options?: ServerOptions) {
    // Use custom id if provided, otherwise generate one
    this.id = options?.id || generateInstanceId();
    this.ackTimeout = options?.ackTimeout ?? DefaultTimeout.ACK;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;
    
    // Get or create shared channel and create dispatcher
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.dispatcher = new MessageDispatcher(channel, MessageRole.SERVER, this.id);
    
    // Auto-open by default (unless explicitly set to false)
    if (options?.autoOpen !== false) {
      this.open();
    }
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

  private handleRequestError(res: ServerResponseImpl, 
    targetWindow: Window,
    targetOrigin: string, 
    data: PostMessageData,
    err: any
  ) {
    if (!res._sent) {
      /** 
       * Use INTERNAL_SERVER_ERROR (500) for handler errors unless a different error status code was explicitly set.
       * If statusCode is still the default OK (200), override it to INTERNAL_SERVER_ERROR.
       */
      const errorStatus = res.statusCode === HttpStatus.OK 
        ? HttpStatus.INTERNAL_SERVER_ERROR 
        : res.statusCode;
      
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
   * Handle request
   */
  private handleRequest(data: PostMessageData, context: MessageContext): void {
    // If targetId is specified, only process if it matches this server's id
    if (!data.path || (data.targetId && data.targetId !== this.id)) return;
    if (!context.source) return;

    // If message has already been handled by another server instance, skip processing
    if (context.handledBy) {
      return;
    }

    const targetWindow = context.source;
    const targetOrigin = context.origin;

    // Use prefixed path to match registered handlers
    const prefixedPath = this.dispatcher.prefixPath(data.path);
    const handlerFn = this.handlers.get(prefixedPath);
    if (!handlerFn) {
      // No handler found in this instance
      // Mark as handled by this instance (using special marker) to prevent other instances from processing
      // This ensures only one instance sends the error response
      context.handledBy = this.id;
      
      // Send METHOD_NOT_FOUND error
      // Use request's creatorId as targetId to route back to the correct client
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

    // Mark message as handled by this server instance to prevent other server instances from processing it
    context.handledBy = this.id;

    // Send ACK immediately via dispatcher
    // Use request's creatorId as targetId to route back to the correct client
    this.dispatcher.sendMessage(
      targetWindow,
      targetOrigin,
      MessageType.ACK,
      data.requestId,
      { 
        path: data.path,
        targetId: data.creatorId
      }
    );

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
      data.creatorId
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

      try {
        const result = handlerFn(req, res);

        if (isPromise(result)) {
          // Async task
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
    
    // Clean up handlers
    this.handlers.clear();
    this.middlewares.length = 0;
    
    // Destroy dispatcher and release channel reference
    this.dispatcher.destroy();
    releaseMessageChannel(this.dispatcher.getChannel());
  }
}
