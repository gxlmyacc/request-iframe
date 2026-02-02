import type {
  ErrorResponse,
  RequestIframeClient,
  RequestIframeServer,
  RequestIframeClientOptions,
  RequestIframeServerOptions
} from '../types';
import { getIframeTargetOrigin } from '../utils/iframe';
import { generateInstanceId } from '../utils/id';
import { isWindowAvailable } from '../utils/window';
import { RequestIframeClientImpl } from '../impl/client';
import { RequestIframeServerImpl } from '../impl/server';
import { setupClientDebugInterceptors, setupServerDebugListeners } from '../utils/debug';
import { setRequestIframeLogLevel } from '../utils/logger';
import { Messages, ErrorCode, OriginConstant, LogLevel } from '../constants';

/**
 * Endpoint facade type (client + server).
 */
export type RequestIframeEndpoint = RequestIframeClient & RequestIframeServer;

/**
 * Endpoint facade options (client + server).
 *
 * - For client-side sending: uses RequestIframeClientOptions fields (targetOrigin, headers, etc.)
 * - For server-side handling: uses RequestIframeServerOptions fields (middlewares, allowedOrigins, etc.)
 *
 * Note: overlapping fields (autoOpen/trace/allowedOrigins/validateOrigin/ackTimeout/autoAckMax*) apply to both sides.
 */
export type RequestIframeEndpointOptions = RequestIframeClientOptions & RequestIframeServerOptions;

class RequestIframeEndpointApiFacade implements RequestIframeEndpoint {
  private readonly targetWindow_: Window;
  private readonly targetOrigin_: string;
  private readonly options_?: RequestIframeEndpointOptions;
  private readonly endpointId_: string;

  private desiredOpen_ = true;
  private client_?: RequestIframeClientImpl;
  private server_?: RequestIframeServerImpl;

  public constructor(params: {
    targetWindow: Window;
    targetOrigin: string;
    options?: RequestIframeEndpointOptions;
    endpointId: string;
  }) {
    this.targetWindow_ = params.targetWindow;
    this.targetOrigin_ = params.targetOrigin;
    this.options_ = params.options;
    this.endpointId_ = params.endpointId;
    this.desiredOpen_ = params.options?.autoOpen !== false;
  }

  /**
   * Lazy create client.
   */
  private getClient(): RequestIframeClientImpl {
    if (!this.client_) {
      const options = this.options_;
      const client = new RequestIframeClientImpl(this.targetWindow_, this.targetOrigin_, {
        secretKey: options?.secretKey,
        ackTimeout: options?.ackTimeout,
        timeout: options?.timeout,
        asyncTimeout: options?.asyncTimeout,
        returnData: (options as any)?.returnData,
        headers: options?.headers,
        allowedOrigins: options?.allowedOrigins,
        validateOrigin: options?.validateOrigin,
        autoOpen: false,
        autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
        autoAckMaxIdLength: options?.autoAckMaxIdLength
      }, this.endpointId_);

      if (options?.trace) {
        const level = options.trace === true ? LogLevel.TRACE : options.trace;
        setRequestIframeLogLevel(level);
        if (level === LogLevel.TRACE || level === LogLevel.INFO) {
          setupClientDebugInterceptors(client);
        }
      }

      this.client_ = client;
    }

    if (this.desiredOpen_ && !this.client_.isOpen) {
      this.client_.open();
    }
    if (!this.desiredOpen_ && this.client_.isOpen) {
      this.client_.close();
    }

    return this.client_;
  }

  /**
   * Lazy create server.
   */
  private getServer(): RequestIframeServerImpl {
    if (!this.server_) {
      const options = this.options_;
      const server = new RequestIframeServerImpl({
        secretKey: options?.secretKey,
        id: this.endpointId_,
        ackTimeout: options?.ackTimeout,
        autoOpen: false,
        allowedOrigins: options?.allowedOrigins,
        validateOrigin: options?.validateOrigin,
        maxConcurrentRequestsPerClient: options?.maxConcurrentRequestsPerClient,
        autoAckMaxMetaLength: options?.autoAckMaxMetaLength,
        autoAckMaxIdLength: options?.autoAckMaxIdLength
      });

      if (options?.trace) {
        const level = options.trace === true ? LogLevel.TRACE : options.trace;
        setRequestIframeLogLevel(level);
        if (level === LogLevel.TRACE || level === LogLevel.INFO) {
          setupServerDebugListeners(server);
        }
      }

      this.server_ = server;
    }

    if (this.desiredOpen_ && !this.server_.isOpen) {
      this.server_.open();
    }
    if (!this.desiredOpen_ && this.server_.isOpen) {
      this.server_.close();
    }

    return this.server_;
  }

  /**
   * Optional accessors for debugging.
   * Note: accessing will trigger lazy creation.
   */
  public get client(): RequestIframeClientImpl {
    return this.getClient();
  }
  public get server(): RequestIframeServerImpl {
    return this.getServer();
  }

  /** Client fields */
  public get targetWindow(): Window {
    return this.targetWindow_;
  }

  public get id(): string {
    return this.endpointId_;
  }

  public get isOpen(): boolean {
    /**
     * Facade-level open state.
     * - When client/server is lazily created later, it will follow this state.
     */
    return this.desiredOpen_;
  }

  public get interceptors(): RequestIframeClient['interceptors'] {
    return this.getClient().interceptors;
  }
  public set interceptors(value: RequestIframeClient['interceptors']) {
    this.getClient().interceptors = value;
  }

  public isAvailable(): boolean {
    return isWindowAvailable(this.targetWindow_);
  }

  public open(): void {
    this.desiredOpen_ = true;
    this.client_?.open();
    this.server_?.open();
  }

  public close(): void {
    this.desiredOpen_ = false;
    this.client_?.close();
    this.server_?.close();
  }

  public destroy(): void {
    /**
     * Destroy created sides only.
     * They share the underlying MessageChannel via cache ref-counting, so partial creation is safe.
     */
    this.client_?.destroy();
    this.server_?.destroy();
    this.client_ = undefined;
    this.server_ = undefined;
  }

  /** Client send APIs */
  public send: RequestIframeClient['send'] = (path, body, options) => this.getClient().send(path, body, options);
  public sendFile: RequestIframeClient['sendFile'] = (path, content, options) => this.getClient().sendFile(path, content, options as any);
  public sendStream: RequestIframeClient['sendStream'] = (path, stream, options) => this.getClient().sendStream(path, stream as any, options);
  public isConnect: RequestIframeClient['isConnect'] = () => this.getClient().isConnect();
  public getCookies: RequestIframeClient['getCookies'] = (path) => this.getClient().getCookies(path);
  public getCookie: RequestIframeClient['getCookie'] = (name, path) => this.getClient().getCookie(name, path);
  public setCookie: RequestIframeClient['setCookie'] = (name, value, options) => this.getClient().setCookie(name, value, options);
  public removeCookie: RequestIframeClient['removeCookie'] = (name, path) => this.getClient().removeCookie(name, path);
  public clearCookies: RequestIframeClient['clearCookies'] = () => this.getClient().clearCookies();

  /** Server fields */
  public get secretKey(): string | undefined {
    return this.options_?.secretKey;
  }

  /** Server routing/middleware APIs */
  public use: RequestIframeServer['use'] = (pathOrMiddleware: any, middleware?: any) => (this.getServer() as any).use(pathOrMiddleware, middleware);
  public on: RequestIframeServer['on'] = (path, handler) => this.getServer().on(path, handler);
  public off: RequestIframeServer['off'] = (path) => this.getServer().off(path as any);
  public map: RequestIframeServer['map'] = (handlers) => this.getServer().map(handlers);
}

/**
 * Create an endpoint facade (client + server) for a peer window/iframe.
 *
 * It can:
 * - send requests to the peer (client)
 * - handle requests from the peer (server)
 */
export function requestIframeEndpoint(
  target: HTMLIFrameElement | Window,
  options?: RequestIframeEndpointOptions
): RequestIframeEndpoint {
  let targetWindow: Window | null = null;
  let targetOrigin: string = OriginConstant.ANY;

  if ((target as HTMLIFrameElement).tagName === 'IFRAME') {
    const iframe = target as HTMLIFrameElement;
    targetWindow = iframe.contentWindow;
    targetOrigin = getIframeTargetOrigin(iframe);
    if (!targetWindow) {
      throw {
        message: Messages.IFRAME_NOT_READY,
        code: ErrorCode.IFRAME_NOT_READY
      } as ErrorResponse;
    }
  } else {
    targetWindow = target as Window;
    targetOrigin = OriginConstant.ANY;
  }

  /** Allow user to override targetOrigin explicitly */
  if (options?.targetOrigin) {
    targetOrigin = options.targetOrigin;
  }

  /**
   * Endpoint uses ONE shared id by default, so it behaves like a single endpoint.
   * If options.id is provided, it becomes the shared id for both client+server.
   */
  const endpointId = options?.id ?? generateInstanceId();

  return new RequestIframeEndpointApiFacade({
    targetWindow,
    targetOrigin,
    options,
    endpointId
  });
}

