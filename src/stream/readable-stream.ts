import {
  StreamType,
  StreamState,
  ReadableStreamOptions,
  IIframeReadableStream,
  StreamMessageData
} from './types';
import { createPostMessage } from '../utils';
import { MessageType, Messages, StreamType as StreamTypeConstant, StreamState as StreamStateConstant, StreamInternalMessageType, MessageRole } from '../constants';

/**
 * Stream message handler interface
 */
export interface StreamMessageHandler {
  /** Register stream message handler */
  registerStreamHandler(streamId: string, handler: (data: StreamMessageData) => void): void;
  /** Unregister handler */
  unregisterStreamHandler(streamId: string): void;
  /** Post message */
  postMessage(message: any): void;
}

/**
 * IframeReadableStream - Client-side readable stream
 * Used to receive stream data sent from the server
 */
export class IframeReadableStream<T = any> implements IIframeReadableStream<T> {
  public readonly streamId: string;
  public readonly type: StreamType;
  public readonly chunked: boolean;
  public readonly metadata?: Record<string, any>;
  
  private _state: StreamState = StreamStateConstant.PENDING;
  private readonly chunks: T[] = [];
  private resolveRead?: (value: T) => void;
  private rejectRead?: (error: Error) => void;
  private onEndCallback?: () => void;
  private onErrorCallback?: (error: Error) => void;
  private readonly messageHandler: StreamMessageHandler;
  private readonly requestId: string;
  private readonly secretKey?: string;

  public constructor(
    streamId: string,
    requestId: string,
    messageHandler: StreamMessageHandler,
    options: ReadableStreamOptions = {}
  ) {
    this.streamId = streamId;
    this.requestId = requestId;
    this.messageHandler = messageHandler;
    this.type = options.type ?? StreamTypeConstant.DATA;
    this.chunked = options.chunked ?? true;
    this.metadata = options.metadata;
    this.secretKey = (options as any).secretKey;
    
    // Register stream message handler
    this.messageHandler.registerStreamHandler(streamId, this.handleStreamMessage.bind(this));
  }

  /** Get stream state */
  public get state(): StreamState {
    return this._state;
  }

  /**
   * Handle stream message
   */
  private handleStreamMessage(data: StreamMessageData): void {
    switch (data.type as string) {
      case StreamInternalMessageType.DATA:
        this.handleData(data.data, data.done);
        break;
      case StreamInternalMessageType.END:
        this.handleEnd();
        break;
      case StreamInternalMessageType.ERROR:
        this.handleError(new Error(data.error || Messages.STREAM_ERROR));
        break;
      case StreamInternalMessageType.CANCEL:
        this.handleCancel(data.reason);
        break;
    }
  }

  /**
   * Handle data chunk (internal method)
   */
  private handleData(data: any, done?: boolean): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.STREAMING;
    const decoded = this.decodeData(data);
    this.chunks.push(decoded);
    
    if (done) {
      this.handleEnd();
    }
  }

  /**
   * Decode data (subclasses can override, e.g., FileStream needs Base64 decoding)
   */
  protected decodeData(data: any): T {
    return data as T;
  }

  /**
   * Stream ended (internal handling)
   */
  private handleEnd(): void {
    if (this._state === StreamStateConstant.ENDED) return;
    
    this._state = StreamStateConstant.ENDED;
    this.messageHandler.unregisterStreamHandler(this.streamId);
    
    if (this.resolveRead) {
      // Merge all data chunks
      const result = this.mergeChunks();
      this.resolveRead(result);
      this.resolveRead = undefined;
      this.rejectRead = undefined;
    }
    
    this.onEndCallback?.();
  }

  /**
   * Merge data chunks (subclasses can override)
   */
  protected mergeChunks(): T {
    if (this.chunks.length === 0) {
      return undefined as T;
    }
    if (this.chunks.length === 1) {
      return this.chunks[0];
    }
    // Default returns array
    return this.chunks as unknown as T;
  }

  /**
   * Stream error (internal method)
   */
  private handleError(error: Error): void {
    if (this._state === StreamStateConstant.ENDED || this._state === StreamStateConstant.ERROR) return;
    
    this._state = StreamStateConstant.ERROR;
    this.messageHandler.unregisterStreamHandler(this.streamId);
    
    if (this.rejectRead) {
      this.rejectRead(error);
      this.resolveRead = undefined;
      this.rejectRead = undefined;
    }
    
    this.onErrorCallback?.(error);
  }

  /**
   * Stream cancelled (internal method)
   */
  private handleCancel(reason?: string): void {
    if (this._state === StreamStateConstant.ENDED || this._state === StreamStateConstant.ERROR || this._state === StreamStateConstant.CANCELLED) return;
    
    this._state = StreamStateConstant.CANCELLED;
    this.messageHandler.unregisterStreamHandler(this.streamId);
    
    const error = new Error(reason || Messages.STREAM_CANCELLED);
    if (this.rejectRead) {
      this.rejectRead(error);
      this.resolveRead = undefined;
      this.rejectRead = undefined;
    }
    
    this.onErrorCallback?.(error);
  }

  /**
   * Read all data
   */
  public read(): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this._state === StreamStateConstant.ENDED) {
        resolve(this.mergeChunks());
        return;
      }
      
      if (this._state === StreamStateConstant.ERROR || this._state === StreamStateConstant.CANCELLED) {
        reject(new Error(Messages.STREAM_READ_ERROR));
        return;
      }
      
      this.resolveRead = resolve;
      this.rejectRead = reject;
    });
  }

  /**
   * Async iterator
   */
  public [Symbol.asyncIterator](): AsyncIterator<T> {
    let index = 0;
    const stream = this;
    
    return {
      async next(): Promise<IteratorResult<T>> {
        // Wait for new data or stream end
        while (index >= stream.chunks.length) {
          if (stream._state === StreamStateConstant.ENDED || stream._state === StreamStateConstant.ERROR || stream._state === StreamStateConstant.CANCELLED) {
            return { done: true, value: undefined as T };
          }
          // Wait a short time before checking again
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        return { done: false, value: stream.chunks[index++] };
      }
    };
  }

  /**
   * Cancel stream
   */
  public cancel(reason?: string): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.CANCELLED;
    
    // Notify server to cancel
    const message = createPostMessage(MessageType.STREAM_CANCEL as any, this.requestId, {
      secretKey: this.secretKey,
      body: {
        streamId: this.streamId,
        reason
      },
      role: MessageRole.CLIENT,
      creatorId: (this.messageHandler as any).id
    });
    this.messageHandler.postMessage(message);
    
    this.messageHandler.unregisterStreamHandler(this.streamId);
  }

  /**
   * Listen for stream end
   */
  public onEnd(callback: () => void): void {
    this.onEndCallback = callback;
    if (this._state === StreamStateConstant.ENDED) {
      callback();
    }
  }

  /**
   * Listen for stream error
   */
  public onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
}
