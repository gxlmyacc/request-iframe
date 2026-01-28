import { ServerResponse, CookieOptions, SendOptions, SendFileOptions } from '../types';
import { createPostMessage, createSetCookie, createClearCookie, detectContentType, blobToBase64 } from '../utils';
import { MessageType, HttpStatus, HttpHeader, getStatusText, MessageRole } from '../constants';
import { IframeWritableStream, IframeFileWritableStream, isIframeWritableStream } from '../stream';
import { MessageChannel } from '../message';



/**
 * Callback waiting for client acknowledgment
 */
type AckCallback = (received: boolean) => void;

/**
 * ServerResponse implementation
 */
export class ServerResponseImpl implements ServerResponse {
  public statusCode: number = HttpStatus.OK;
  public headers: Record<string, string | string[]> = {};
  private readonly requestId: string;
  private readonly path: string;
  private readonly secretKey?: string;
  private readonly targetWindow: Window;
  private readonly targetOrigin: string;
  private readonly channel: MessageChannel;
  /** Target client ID (usually the creatorId of the original request) */
  private readonly targetId?: string;
  /** Server instance ID (for creatorId in responses) */
  private readonly serverId?: string;
  private onAckCallback?: AckCallback;
  public _sent = false;

  constructor(
    requestId: string,
    path: string,
    secretKey: string | undefined,
    targetWindow: Window,
    targetOrigin: string,
    channel: MessageChannel,
    serverId?: string,
    targetId?: string
  ) {
    this.requestId = requestId;
    this.path = path;
    this.secretKey = secretKey;
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.channel = channel;
    this.serverId = serverId;
    this.targetId = targetId;
  }

  /**
   * Send message via channel
   */
  private sendMessage(message: any): void {
    this.channel.send(this.targetWindow, message, this.targetOrigin);
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
  public _triggerAck(received: boolean): void {
    if (this.onAckCallback) {
      this.onAckCallback(received);
      this.onAckCallback = undefined;
    }
  }

  /**
   * Internal method: send raw data (used by send after type detection)
   */
  private _sendRaw(data: any, options?: SendOptions): Promise<boolean> {
    if (this._sent) return Promise.resolve(false);
    this._sent = true;

    const requireAck = options?.requireAck ?? false;

    // If acknowledgment not required, send directly and return true
    if (!requireAck) {
      this.sendMessage(
        createPostMessage(MessageType.RESPONSE, this.requestId, {
          path: this.path,
          secretKey: this.secretKey,
          data,
          status: this.statusCode,
          statusText: getStatusText(this.statusCode),
          headers: this.headers,
          requireAck: false,
          role: MessageRole.SERVER,
          creatorId: this.serverId,
          targetId: this.targetId
        })
      );
      return Promise.resolve(true);
    }

    // Acknowledgment required, wait for client response
    return new Promise((resolve) => {
      this._setOnAckCallback(resolve);

      this.sendMessage(
        createPostMessage(MessageType.RESPONSE, this.requestId, {
          path: this.path,
          secretKey: this.secretKey,
          data,
          status: this.statusCode,
          statusText: getStatusText(this.statusCode),
          headers: this.headers,
          requireAck: true,
          role: MessageRole.SERVER,
          creatorId: this.serverId,
          targetId: this.targetId
        })
      );
    });
  }

  /**
   * Universal send method - automatically detects data type and calls appropriate method
   * - If data is IframeWritableStream, calls sendStream
   * - If data is File/Blob, calls sendFile
   * - Otherwise, sends as regular data with auto-detected Content-Type
   */
  public async send(data: any, options?: SendOptions): Promise<boolean> {
    if (this._sent) return Promise.resolve(false);

    // Check if data is a stream (IframeWritableStream)
    if (isIframeWritableStream(data)) {
      // It's a stream, use sendStream
      await this.sendStream(data);
      // sendStream doesn't return boolean, but send needs to maintain API
      // Since sendStream handles requireAck internally, we return true
      return true;
    }

    // Check if data is File or Blob
    if (
      (typeof File !== 'undefined' && data instanceof File) ||
      (typeof Blob !== 'undefined' && data instanceof Blob)
    ) {
      // Extract options for sendFile
      const fileOptions: SendFileOptions = {
        requireAck: options?.requireAck,
        // If it's a File, use its type and name
        ...(typeof File !== 'undefined' && data instanceof File
          ? { mimeType: data.type, fileName: data.name }
          : {})
      };
      return this.sendFile(data, fileOptions);
    }

    // For other types, auto-detect and set Content-Type, then send
    this.ensureContentTypeIfNeeded(data);
    return this._sendRaw(data, options);
  }

  public json(data: any, options?: SendOptions): Promise<boolean> {
    return this.send(data, options);
  }

  public async sendFile(
    content: string | Blob | File,
    options?: SendFileOptions
  ): Promise<boolean> {
    if (this._sent) return false;

    let mimeType = options?.mimeType || 'application/octet-stream';
    let fileName = options?.fileName;
    let fileContent: string | Uint8Array;

    // Convert content to base64 string or Uint8Array
    if (typeof content === 'string') {
      // If it's a plain string, convert to base64
      fileContent = btoa(unescape(encodeURIComponent(content)));
    } else if (content instanceof File) {
      mimeType = content.type || mimeType;
      fileName = fileName || content.name;
      fileContent = await blobToBase64(content);
    } else {
      // Blob - convert to base64
      fileContent = await blobToBase64(content);
    }

    // Set file-related headers
    this.setHeader(HttpHeader.CONTENT_TYPE, mimeType);
    if (fileName) {
      this.setHeader(HttpHeader.CONTENT_DISPOSITION, `attachment; filename="${fileName}"`);
    } else {
      this.setHeader(HttpHeader.CONTENT_DISPOSITION, 'attachment');
    }

    // Create file stream with autoResolve enabled
    const stream = new IframeFileWritableStream({
      filename: fileName || 'file',
      mimeType,
      chunked: false, // File is sent in one chunk
      autoResolve: true, // Client will automatically resolve to fileData
      next: async () => {
        // Send file content as a single chunk
        return {
          data: fileContent,
          done: true
        };
      }
    });

    // Send stream (this will handle the requireAck logic internally and set _sent)
    await this.sendStream(stream);

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
    this._sent = true;

    // Bind stream to request context
    stream._bind({
      requestId: this.requestId,
      targetWindow: this.targetWindow,
      targetOrigin: this.targetOrigin,
      secretKey: this.secretKey,
      channel: this.channel,
      serverId: this.serverId,
      targetId: this.targetId
    });

    // Start stream transmission
    await stream.start();
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
