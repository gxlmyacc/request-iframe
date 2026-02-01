import type { PostMessageData } from '../../types';
import { MessageDispatcher } from '../../message';
import type { IIframeWritableStream, StreamBindContext, StreamMessageData } from '../../stream/types';
import { isIframeWritableStream } from '../../stream';
import { createIframeFileWritableStreamFromContent } from '../stream/file-writable';
import { SyncHook } from '../../utils/hooks';

type MaybePromise<T> = T | Promise<T>;

/**
 * Outbox hooks for send pipelines.
 */
export interface RequestIframeOutboxSendHooks<TResult> {
  /**
   * Runs before the actual operation.
   */
  before?: () => MaybePromise<void>;
  /**
   * Runs on success (before finally).
   */
  end?: (result: TResult) => MaybePromise<void>;
  /**
   * Runs on error.
   * - If provided, its return value becomes the final result (and the error is swallowed).
   * - If not provided, error will be thrown.
   */
  error?: (err: any) => MaybePromise<TResult>;
  /**
   * Runs in finally (always).
   */
  finally?: () => MaybePromise<void>;
}

/**
 * Stream send pipeline params.
 */
export interface RequestIframeOutboxSendStreamParams<TResult> extends RequestIframeOutboxSendHooks<TResult> {
  stream: IIframeWritableStream;
  bind: Parameters<RequestIframeEndpointOutbox['createStreamBindContext']>[0];
  /**
   * Default true. If false, stream.start() will be triggered but not awaited.
   * (Used by client request-body streams: REQUEST must be sent first.)
   */
  awaitStart?: boolean;
  /**
   * Hook before start. Return value becomes sendStream's result.
   * (Client uses it to send REQUEST and return the pending response promise.)
   */
  beforeStart?: (ctx: { stream: IIframeWritableStream }) => MaybePromise<TResult>;
}

/**
 * File send pipeline params.
 */
export interface RequestIframeOutboxSendFileParams<TResult> extends RequestIframeOutboxSendHooks<TResult> {
  content: string | Blob | File;
  fileName?: string;
  mimeType?: string;
  chunked?: boolean;
  autoResolve?: boolean;
  defaultFileName?: string;
  defaultMimeType?: string;
  /**
   * Called after file stream is created (before stream start).
   * Useful for response to set headers based on inferred fileName/mimeType.
   */
  onFileInfo?: (info: { fileName?: string; mimeType: string }) => MaybePromise<void>;
  stream: Omit<RequestIframeOutboxSendStreamParams<TResult>, 'stream'>;
}

/**
 * Universal send pipeline params.
 */
export interface RequestIframeOutboxSendParams<TResult> extends RequestIframeOutboxSendHooks<TResult> {
  data: any;
  onOther: (data: any) => MaybePromise<TResult>;
  onStream?: (stream: IIframeWritableStream) => MaybePromise<TResult>;
  onFileOrBlob?: (fileOrBlob: Blob | File) => MaybePromise<TResult>;
}

function safeIsFile(data: any): boolean {
  try {
    return typeof File !== 'undefined' && data instanceof File;
  } catch {
    return false;
  }
}

function safeIsBlob(data: any): boolean {
  try {
    return typeof Blob !== 'undefined' && data instanceof Blob;
  } catch {
    return false;
  }
}

/**
 * RequestIframeEndpointOutbox
 *
 * A lightweight "built-in sender" bound to a fixed peer (targetWindow/targetOrigin).
 * Used by request/response-side objects to send messages without repeatedly passing
 * targetWindow/targetOrigin.
 */
export class RequestIframeEndpointOutbox {
  public readonly hooks = {
    beforeSendRaw: new SyncHook<[message: PostMessageData]>(),
    afterSendRaw: new SyncHook<[message: PostMessageData, ok: boolean]>(),
    sendRawError: new SyncHook<[message: PostMessageData, error: any]>(),
    beforeSendMessage: new SyncHook<[type: PostMessageData['type'], requestId: string, payload: any]>(),
    afterSendMessage: new SyncHook<[type: PostMessageData['type'], requestId: string, payload: any, ok: boolean]>(),
    sendMessageError: new SyncHook<[type: PostMessageData['type'], requestId: string, payload: any, error: any]>()
  };

  public readonly dispatcher: MessageDispatcher;
  public readonly targetWindow: Window;
  public readonly targetOrigin: string;
  public defaultTargetId?: string;

  public constructor(
    dispatcher: MessageDispatcher,
    targetWindow: Window,
    targetOrigin: string,
    defaultTargetId?: string
  ) {
    this.dispatcher = dispatcher;
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.defaultTargetId = defaultTargetId;
  }

  public setDefaultTargetId(targetId?: string): void {
    this.defaultTargetId = targetId;
  }

  public get secretKey(): string | undefined {
    return this.dispatcher.secretKey;
  }

  public get channel() {
    return this.dispatcher.getChannel();
  }

  private async runWithHooks<TResult>(
    hooks: RequestIframeOutboxSendHooks<TResult>,
    fn: () => MaybePromise<TResult>
  ): Promise<TResult> {
    try {
      if (hooks.before) {
        await hooks.before();
      }
      const result = await fn();
      if (hooks.end) {
        await hooks.end(result);
      }
      return result;
    } catch (e) {
      if (hooks.error) {
        return await hooks.error(e);
      }
      throw e;
    } finally {
      if (hooks.finally) {
        await hooks.finally();
      }
    }
  }

  /**
   * Create a stream bind context using this peer's fixed target info.
   *
   * This helps unify the duplicated `_bind({ targetWindow, targetOrigin, secretKey, channel, ... })` logic
   * across client/server response implementations.
   */
  public createStreamBindContext(params: {
    requestId: string;
    registerStreamHandler?: (streamId: string, handler: (data: StreamMessageData) => void) => void;
    unregisterStreamHandler?: (streamId: string) => void;
    heartbeat?: () => Promise<boolean>;
    serverId?: string;
    clientId?: string;
    targetId?: string;
  }): StreamBindContext {
    return {
      requestId: params.requestId,
      targetWindow: this.targetWindow,
      targetOrigin: this.targetOrigin,
      secretKey: this.secretKey,
      channel: this.channel,
      registerStreamHandler: params.registerStreamHandler,
      unregisterStreamHandler: params.unregisterStreamHandler,
      heartbeat: params.heartbeat,
      serverId: params.serverId,
      clientId: params.clientId,
      targetId: params.targetId ?? this.defaultTargetId
    };
  }

  /**
   * Bind and start a writable stream to this peer.
   *
   * Note:
   * - Client-side request-body streams may need to delay `start()` until after REQUEST is sent.
   *   For that case, prefer `createStreamBindContext()` + manual `stream.start()`.
   */
  public async sendWritableStream(
    stream: IIframeWritableStream,
    params: Parameters<RequestIframeEndpointOutbox['createStreamBindContext']>[0]
  ): Promise<void> {
    stream._bind(this.createStreamBindContext(params));
    await stream.start();
  }

  /**
   * Universal send - dispatch by data type, then call hooks to implement differences.
   */
  public async send<TResult>(params: RequestIframeOutboxSendParams<TResult>): Promise<TResult> {
    return this.runWithHooks(params, async () => {
      const data = params.data;

      if (isIframeWritableStream(data)) {
        if (params.onStream) return await params.onStream(data as any);
        return await params.onOther(data);
      }

      if (safeIsFile(data) || safeIsBlob(data)) {
        if (params.onFileOrBlob) return await params.onFileOrBlob(data);
        return await params.onOther(data);
      }

      return await params.onOther(data);
    });
  }

  private async runStreamSend<TResult>(params: RequestIframeOutboxSendStreamParams<TResult>): Promise<TResult> {
    params.stream._bind(this.createStreamBindContext(params.bind));

    const resultPromise = params.beforeStart ? params.beforeStart({ stream: params.stream }) : undefined;

    if (params.awaitStart === false) {
      /**
       * Fire-and-forget:
       * - request-body stream must start after REQUEST is sent (beforeStart is expected to send REQUEST synchronously)
       * - we must NOT await the response promise before starting stream, otherwise server will time out waiting stream_start
       */
      void params.stream.start();
      return (await resultPromise) as TResult;
    }

    const result = (await resultPromise) as TResult;
    await params.stream.start();
    return result;
  }

  /**
   * Send writable stream via peer.
   */
  public async sendStream<TResult = void>(params: RequestIframeOutboxSendStreamParams<TResult>): Promise<TResult> {
    return this.runWithHooks(params, async () => {
      return await this.runStreamSend(params);
    });
  }

  /**
   * Send File/Blob/string as a file stream via peer.
   */
  public async sendFile<TResult>(params: RequestIframeOutboxSendFileParams<TResult>): Promise<TResult> {
    return this.runWithHooks(params, async () => {
      const created = await createIframeFileWritableStreamFromContent({
        content: params.content,
        fileName: params.fileName,
        mimeType: params.mimeType,
        chunked: params.chunked,
        autoResolve: params.autoResolve,
        defaultFileName: params.defaultFileName,
        defaultMimeType: params.defaultMimeType
      });

      await params.onFileInfo?.({ fileName: created.fileName, mimeType: created.mimeType });

      return await this.runStreamSend({
        ...(params.stream as any),
        stream: created.stream as any
      });
    });
  }

  /**
   * Send typed message with peer pre-bound.
   */
  public sendMessage(
    type: PostMessageData['type'],
    requestId: string,
    data?: Partial<Omit<PostMessageData, '__requestIframe__' | 'type' | 'requestId' | 'timestamp' | 'role' | 'creatorId'>>
  ): boolean {
    const payload: any = {
      ...(data || {})
    };
    if (payload.targetId === undefined && this.defaultTargetId !== undefined) {
      payload.targetId = this.defaultTargetId;
    }
    this.hooks.beforeSendMessage.call(type, requestId, payload);
    try {
      const ok = this.dispatcher.sendMessage(this.targetWindow, this.targetOrigin, type, requestId, payload);
      this.hooks.afterSendMessage.call(type, requestId, payload, ok);
      return ok;
    } catch (e) {
      this.hooks.sendMessageError.call(type, requestId, payload, e);
      throw e;
    }
  }

  /**
   * Send raw message with peer pre-bound.
   */
  public sendRaw(message: PostMessageData): boolean {
    this.hooks.beforeSendRaw.call(message);
    try {
      const ok = this.dispatcher.send(this.targetWindow, message, this.targetOrigin);
      this.hooks.afterSendRaw.call(message, ok);
      return ok;
    } catch (e) {
      this.hooks.sendRawError.call(message, e);
      throw e;
    }
  }
}

