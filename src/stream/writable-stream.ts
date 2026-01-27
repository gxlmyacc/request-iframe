import {
  StreamType,
  StreamState,
  StreamBindContext,
  WritableStreamOptions,
  IIframeWritableStream,
  StreamChunk
} from './types';
import { createPostMessage } from '../utils';
import { MessageType, Messages, StreamType as StreamTypeConstant, StreamState as StreamStateConstant, MessageRole } from '../constants';

/**
 * Generate a unique stream ID
 */
function generateStreamId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * IframeWritableStream - Server-side writable stream
 * Used to send stream data to the client
 */
export class IframeWritableStream implements IIframeWritableStream {
  public readonly streamId: string;
  public readonly type: StreamType;
  public readonly chunked: boolean;
  
  private _state: StreamState = StreamStateConstant.PENDING;
  private context: StreamBindContext | null = null;
  private readonly iterator?: () => AsyncGenerator<any, void, unknown>;
  private readonly nextFn?: () => Promise<StreamChunk> | StreamChunk;
  private readonly metadata?: Record<string, any>;
  private readonly autoResolve?: boolean;

  public constructor(options: WritableStreamOptions = {}) {
    this.streamId = generateStreamId();
    this.type = options.type ?? StreamTypeConstant.DATA;
    this.chunked = options.chunked ?? true;
    this.iterator = options.iterator;
    this.nextFn = options.next;
    this.metadata = options.metadata;
    this.autoResolve = options.autoResolve;
  }

  /** Get stream state */
  public get state(): StreamState {
    return this._state;
  }

  /**
   * Bind to request context
   * Called during res.sendStream()
   */
  public _bind(context: StreamBindContext): void {
    this.context = context;
  }

  /**
   * Send message to client
   */
  private sendMessage(type: string, data?: Record<string, any>): void {
    if (!this.context) {
      throw new Error(Messages.STREAM_NOT_BOUND);
    }
    
    const message = createPostMessage(type as any, this.context.requestId, {
      secretKey: this.context.secretKey,
      body: {
        streamId: this.streamId,
        ...data
      },
      role: MessageRole.SERVER,
      senderId: this.context.serverId
    });
    
    // Use channel if available, otherwise use direct postMessage
    if (this.context.channel) {
      this.context.channel.send(this.context.targetWindow, message, this.context.targetOrigin);
    } else {
      this.context.targetWindow.postMessage(message, this.context.targetOrigin);
    }
  }

  /**
   * Start stream transfer
   */
  public async start(): Promise<void> {
    if (!this.context) {
      throw new Error(Messages.STREAM_NOT_BOUND);
    }
    
    if (this._state !== StreamStateConstant.PENDING) {
      throw new Error(Messages.STREAM_ALREADY_STARTED);
    }

    this._state = StreamStateConstant.STREAMING;

    // Send stream start message
    this.sendMessage(MessageType.STREAM_START, {
      type: this.type,
      chunked: this.chunked,
      metadata: this.metadata,
      autoResolve: this.autoResolve
    });

    try {
      if (this.iterator) {
        // Generate data using iterator
        await this.streamFromIterator();
      } else if (this.nextFn) {
        // Generate data using next function
        await this.streamFromNext();
      } else {
        // No data source, end directly
        this.end();
      }
    } catch (error: any) {
      this.error(error.message || String(error));
    }
  }

  /**
   * Generate data from iterator
   */
  private async streamFromIterator(): Promise<void> {
    if (!this.iterator) return;
    
    const gen = this.iterator();
    
    try {
      for await (const chunk of gen) {
        if (this._state !== StreamStateConstant.STREAMING) {
          break;
        }
        this.sendData(chunk);
      }
      
      if (this._state === StreamStateConstant.STREAMING) {
        this.end();
      }
    } catch (error: any) {
      if (this._state === StreamStateConstant.STREAMING) {
        this.error(error.message || String(error));
      }
    }
  }

  /**
   * Generate data from next function
   */
  private async streamFromNext(): Promise<void> {
    if (!this.nextFn) return;
    
    try {
      while (this._state === StreamStateConstant.STREAMING) {
        const result = await Promise.resolve(this.nextFn());
        
        if (result.done) {
          this.sendData(result.data, true);
          this.end();
          break;
        }
        
        this.sendData(result.data);
      }
    } catch (error: any) {
      if (this._state === StreamStateConstant.STREAMING) {
        this.error(error.message || String(error));
      }
    }
  }

  /**
   * Send data chunk
   */
  private sendData(data: any, done: boolean = false): void {
    this.sendMessage(MessageType.STREAM_DATA, {
      data: this.encodeData(data),
      done
    });
  }

  /**
   * Encode data (subclasses can override, e.g., FileStream needs Base64 encoding)
   */
  protected encodeData(data: any): any {
    return data;
  }

  /**
   * End stream
   */
  private end(): void {
    if (this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.ENDED;
    this.sendMessage(MessageType.STREAM_END);
  }

  /**
   * Send error
   */
  private error(message: string): void {
    if (this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.ERROR;
    this.sendMessage(MessageType.STREAM_ERROR, {
      error: message
    });
  }

  /**
   * Cancel stream transfer
   */
  public cancel(reason?: string): void {
    if (this._state !== StreamStateConstant.PENDING && this._state !== StreamStateConstant.STREAMING) return;
    
    this._state = StreamStateConstant.CANCELLED;
    
    if (this.context) {
      this.sendMessage(MessageType.STREAM_CANCEL, {
        reason
      });
    }
  }
}
