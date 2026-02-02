import { ServerResponse, CookieOptions, SendOptions, SendFileOptions } from '../types';
import { createSetCookie, createClearCookie } from '../utils/cookie';
import { detectContentType } from '../utils/content-type';
import { MessageType, HttpStatus, HttpHeader, getStatusText, ErrorCode } from '../constants';
import { IframeWritableStream, isIframeWritableStream } from '../stream';
import { RequestIframeEndpointOutbox } from '../endpoint';
import { buildExpectedAck, isExpectedAckMatch } from '../endpoint';
import type { IIframeWritableStream } from '../stream';



/**
 * Callback waiting for client acknowledgment
 */
type AckCallback = (received: boolean, ack?: any) => void;
type OnSentCallback = () => void;

/**
 * ServerResponse implementation
 */
export class ServerResponseImpl implements ServerResponse {
  public statusCode: number = HttpStatus.OK;
  public headers: Record<string, string | string[]> = {};
  private readonly requestId: string;
  private readonly path: string;
  private readonly peer: RequestIframeEndpointOutbox;
  private readonly registerStreamHandler?: (streamId: string, handler: (data: any) => void) => void;
  private readonly unregisterStreamHandler?: (streamId: string) => void;
  private readonly heartbeat?: () => Promise<boolean>;
  /** Server instance ID (for creatorId in responses) */
  private readonly serverId?: string;
  private onAckCallback?: AckCallback;
  private onSentCallback?: OnSentCallback;
  public _sent = false;

  constructor(
    requestId: string,
    path: string,
    serverId?: string,
    peer?: RequestIframeEndpointOutbox,
    options?: {
      registerStreamHandler?: (streamId: string, handler: (data: any) => void) => void;
      unregisterStreamHandler?: (streamId: string) => void;
      heartbeat?: () => Promise<boolean>;
      onSent?: OnSentCallback;
    }
  ) {
    this.requestId = requestId;
    this.path = path;
    this.serverId = serverId;
    this.peer = peer as any;
    this.registerStreamHandler = options?.registerStreamHandler;
    this.unregisterStreamHandler = options?.unregisterStreamHandler;
    this.heartbeat = options?.heartbeat;
    this.onSentCallback = options?.onSent;
  }

  /**
   * Send message via bound peer
   */
  private sendResponseMessage(data: any): boolean {
    return this.peer.sendMessage(MessageType.RESPONSE, this.requestId, data);
  }

  /**
   * Check if header exists (case-insensitive)
   */
  private hasHeader(name: string): boolean {
    const lower = name.toLowerCase();
    return Object.keys(this.headers).some((k) => k.toLowerCase() === lower);
  }

  /**
   * Detect data type and return appropriate Content-Type
   * Returns null if Content-Type should not be auto-set
   */
  private detectContentType(data: any): string | null {
    return detectContentType(data, { checkStream: true, isIframeWritableStream });
  }

  /**
   * Auto set Content-Type based on data type (only if user not set)
   */
  private ensureContentTypeIfNeeded(data: any): void {
    if (this.hasHeader(HttpHeader.CONTENT_TYPE)) return;
    const contentType = this.detectContentType(data);
    if (contentType) {
      this.setHeader(HttpHeader.CONTENT_TYPE, contentType);
    }
  }

  /**
   * Set callback waiting for client acknowledgment
   */
  public _setOnAckCallback(callback: AckCallback): void {
    this.onAckCallback = callback;
  }

  /**
   * Trigger client acknowledgment callback
   */
  public _triggerAck(received: boolean, ack?: any): void {
    if (this.onAckCallback) {
      this.onAckCallback(received, ack);
      this.onAckCallback = undefined;
    }
  }

  /**
   * Mark response as sent (and trigger onSent callback once).
   */
  private markSent(): void {
    if (this._sent) return;
    this._sent = true;
    if (this.onSentCallback) {
      const cb = this.onSentCallback;
      this.onSentCallback = undefined;
      cb();
    }
  }

  /**
   * Internal: mark as sent for manual error responses.
   */
  public _markSent(): void {
    this.markSent();
  }

  /**
   * Internal method: send raw data (used by send after type detection)
   */
  private _sendRaw(data: any, options?: SendOptions): Promise<boolean> {
    if (this._sent) return Promise.resolve(false);
    this.markSent();

    const requireAck = options?.requireAck ?? false;
    /**
     * When requireAck is enabled, attach a unique ack payload by default so ACK can be
     * unambiguously associated with this send.
     *
     * NOTE: ack is an internal reserved field (not part of public API).
     */
    const expectedAck =
      buildExpectedAck(requireAck, (options as any)?.ack);

    try {
      // If acknowledgment not required, send directly and return true
      if (!requireAck) {
        this.sendResponseMessage({
          path: this.path,
          data,
          status: this.statusCode,
          statusText: getStatusText(this.statusCode),
          headers: this.headers,
          requireAck: false
        });
        return Promise.resolve(true);
      }

      // Acknowledgment required, wait for client response
      return new Promise((resolve, reject) => {
        try {
          this._setOnAckCallback((received, receivedAckMeta) => {
            if (!received) {
              resolve(false);
              return;
            }
            if (!isExpectedAckMatch(expectedAck, (receivedAckMeta as any))) {
              resolve(false);
              return;
            }
            resolve(true);
          });

          this.sendResponseMessage({
            path: this.path,
            data,
            status: this.statusCode,
            statusText: getStatusText(this.statusCode),
            headers: this.headers,
            requireAck: true,
            ack: expectedAck
          });
        } catch (error: any) {
          // If window is closed, reject immediately
          if (error?.code === ErrorCode.TARGET_WINDOW_CLOSED) {
            reject(error);
          } else {
            throw error;
          }
        }
      });
    } catch (error: any) {
      // If window is closed, return rejected promise
      if (error?.code === ErrorCode.TARGET_WINDOW_CLOSED) {
        return Promise.reject(error);
      }
      throw error;
    }
  }

  /**
   * Universal send method - automatically detects data type and calls appropriate method
   * - If data is IframeWritableStream, calls sendStream
   * - If data is File/Blob, calls sendFile
   * - Otherwise, sends as regular data with auto-detected Content-Type
   */
  public async send(data: any, options?: SendOptions): Promise<boolean> {
    if (this._sent) return Promise.resolve(false);

    return this.peer.send<boolean>({
      data,
      onStream: async (stream) => {
        await this.sendStream(stream as any);
        return true;
      },
      onFileOrBlob: () => {
        // Extract options for sendFile
        const fileOptions: SendFileOptions = {
          requireAck: options?.requireAck,
          // If it's a File, use its type and name
          ...(typeof File !== 'undefined' && data instanceof File ? { mimeType: data.type, fileName: data.name } : {})
        };
        return this.sendFile(data, fileOptions);
      },
      onOther: () => {
        // For other types, auto-detect and set Content-Type, then send
        this.ensureContentTypeIfNeeded(data);
        return this._sendRaw(data, options);
      }
    });
  }

  public json(data: any, options?: SendOptions): Promise<boolean> {
    return this.send(data, options);
  }

  public async sendFile(
    content: string | Blob | File,
    options?: SendFileOptions
  ): Promise<boolean> {
    if (this._sent) return false;

    await this.peer.sendFile<void>({
      content,
      fileName: options?.fileName,
      mimeType: options?.mimeType,
      chunked: false,
      autoResolve: true,
      defaultFileName: 'file',
      defaultMimeType: 'application/octet-stream'
      ,onFileInfo: ({ fileName, mimeType }) => {
        // Set file-related headers
        this.setHeader(HttpHeader.CONTENT_TYPE, mimeType);
        if (fileName) {
          this.setHeader(HttpHeader.CONTENT_DISPOSITION, `attachment; filename="${fileName}"`);
        } else {
          this.setHeader(HttpHeader.CONTENT_DISPOSITION, 'attachment');
        }
        this.markSent();
      },
      stream: {
        bind: {
          requestId: this.requestId,
          registerStreamHandler: this.registerStreamHandler,
          unregisterStreamHandler: this.unregisterStreamHandler,
          heartbeat: this.heartbeat,
          serverId: this.serverId,
          targetId: this.peer.defaultTargetId
        },
        awaitStart: true
      }
    });

    // For backward compatibility, return true if requireAck is false
    // Note: sendStream doesn't return a boolean, but sendFile needs to maintain its API
    // Since sendStream handles everything, we return true
    return true;
  }

  /**
   * Send stream response
   * Bind stream to current request context and start stream transmission
   */
  public async sendStream(stream: IframeWritableStream): Promise<void> {
    if (this._sent) return;
    await this.peer.sendStream<void>({
      stream: stream as unknown as IIframeWritableStream,
      bind: {
        requestId: this.requestId,
        registerStreamHandler: this.registerStreamHandler,
        unregisterStreamHandler: this.unregisterStreamHandler,
        heartbeat: this.heartbeat,
        serverId: this.serverId,
        targetId: this.peer.defaultTargetId
      },
      awaitStart: true,
      beforeStart: () => {
        this.markSent();
      }
    });
  }

  public status(code: number): ServerResponse {
    this.statusCode = code;
    return this;
  }

  public setHeader(name: string, value: string | number | string[]): void {
    // Consistent with Express, returns void
    // Special handling for Set-Cookie, keep as array
    if (name.toLowerCase() === HttpHeader.SET_COOKIE.toLowerCase()) {
      const existing = this.headers[HttpHeader.SET_COOKIE];
      if (Array.isArray(value)) {
        this.headers[HttpHeader.SET_COOKIE] = Array.isArray(existing) 
          ? [...existing, ...value] 
          : value;
      } else {
        const newValue = String(value);
        if (Array.isArray(existing)) {
          existing.push(newValue);
        } else {
          this.headers[HttpHeader.SET_COOKIE] = [newValue];
        }
      }
    } else if (Array.isArray(value)) {
      this.headers[name] = value.join(', ');
    } else {
      this.headers[name] = String(value);
    }
  }

  public set(name: string, value: string | number | string[]): ServerResponse {
    // Chainable version, compatible with Express res.set
    this.setHeader(name, value);
    return this;
  }

  public cookie(
    name: string,
    value: string,
    options?: CookieOptions
  ): ServerResponse {
    /**
     * Set Cookie (similar to HTTP Set-Cookie)
     * Generate Set-Cookie string and add to headers[HttpHeader.SET_COOKIE] array
     * Client will parse and save to cookie storage upon receiving
     */
    const setCookieStr = createSetCookie(name, value, {
      path: options?.path,
      expires: options?.expires,
      maxAge: options?.maxAge,
      httpOnly: options?.httpOnly,
      secure: options?.secure,
      sameSite: options?.sameSite === true ? 'Strict' 
        : options?.sameSite === false ? undefined 
        : options?.sameSite as 'Strict' | 'Lax' | 'None' | undefined
    });
    
    // Add to Set-Cookie header array
    const existing = this.headers[HttpHeader.SET_COOKIE];
    if (Array.isArray(existing)) {
      existing.push(setCookieStr);
    } else {
      this.headers[HttpHeader.SET_COOKIE] = [setCookieStr];
    }
    
    return this;
  }

  public clearCookie(
    name: string,
    options?: CookieOptions
  ): ServerResponse {
    /**
     * Clear specified Cookie
     * Generate an expired Set-Cookie string, client will delete this cookie upon receiving
     */
    const setCookieStr = createClearCookie(name, { path: options?.path });
    
    // Add to Set-Cookie header array
    const existing = this.headers[HttpHeader.SET_COOKIE];
    if (Array.isArray(existing)) {
      existing.push(setCookieStr);
    } else {
      this.headers[HttpHeader.SET_COOKIE] = [setCookieStr];
    }
    
    return this;
  }

}
