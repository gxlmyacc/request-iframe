import type { HandlerOptions, MessageHandlerFn, MessageTypeMatcher, VersionValidator } from '../../message';
import { MessageDispatcher } from '../../message';
import type { PostMessageData } from '../../types';
import type { MessageContext } from '../../message';
import { isCompatibleVersion } from '../../utils';
import { OriginConstant, Messages } from '../../constants';
import type { MessageRoleValue } from '../../constants';
import { getOrCreateMessageChannel, releaseMessageChannel } from '../../utils/cache';
import { RequestIframeEndpointOutbox } from './outbox';
import { SyncHook } from '../../utils/hooks';

/**
 * Pending manager for maps and timers.
 *
 * - Track all pending maps created by hub
 * - Track all timeouts created by hub
 * - Provide a unified cleanup when destroying
 */
class RequestIframePendingManager {
  private readonly maps = new Map<string, Map<any, any>>();
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Get or create a named pending map that will be auto-cleared on destroy.
   */
  public map<K, V>(name: string): Map<K, V> {
    const existing = this.maps.get(name);
    if (existing) return existing as Map<K, V>;
    const m = new Map<K, V>();
    this.maps.set(name, m as any);
    return m;
  }

  public get<K, V>(name: string, key: K): V | undefined {
    return this.map<K, V>(name).get(key);
  }

  public set<K, V>(name: string, key: K, value: V): void {
    this.map<K, V>(name).set(key, value);
  }

  public has<K>(name: string, key: K): boolean {
    return this.map<K, any>(name).has(key);
  }

  public delete<K>(name: string, key: K): boolean {
    return this.map<K, any>(name).delete(key);
  }

  /**
   * Create a timeout that will be auto-cleared on destroy.
   */
  public setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
    return id;
  }

  /**
   * Clear a tracked timeout.
   */
  public clearTimeout(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
    this.timeouts.delete(id);
  }

  /**
   * Clear all tracked pending maps and timeouts.
   */
  public clearAll(): void {
    this.timeouts.forEach((id) => clearTimeout(id));
    this.timeouts.clear();
    this.maps.forEach((m) => m.clear());
  }
}

/**
 * Generic counter/limiter utilities (built on hub.pending maps).
 *
 * This is intended as a shared infrastructure for both client/server:
 * - server can limit max concurrent in-flight requests per client
 * - client can limit max concurrent streams / in-flight sends in future
 */
class RequestIframeLimiter {
  private readonly pending: RequestIframePendingManager;

  public constructor(pending: RequestIframePendingManager) {
    this.pending = pending;
  }

  public get(bucket: string, key: string): number {
    return this.pending.get<string, number>(bucket, key) ?? 0;
  }

  /**
   * Try acquire one permit for the given key.
   * Returns true if acquired, false if limit reached.
   */
  public tryAcquire(bucket: string, key: string, limit: number): boolean {
    if (!Number.isFinite(limit)) {
      /** Treat Infinity as always allowed but still count for symmetry */
      const next = this.get(bucket, key) + 1;
      this.pending.set(bucket, key, next);
      return true;
    }
    const current = this.get(bucket, key);
    if (current >= limit) return false;
    this.pending.set(bucket, key, current + 1);
    return true;
  }

  /**
   * Release one permit for the given key.
   */
  public release(bucket: string, key: string): void {
    const current = this.get(bucket, key);
    const next = current - 1;
    if (next <= 0) {
      this.pending.delete(bucket, key);
      return;
    }
    this.pending.set(bucket, key, next);
  }
}

/**
 * Shared options for endpoint hub.
 */
export interface RequestIframeEndpointHubOptions {
  /** Message isolation key */
  secretKey?: string;
  /** Protocol version validator (optional, uses built-in validation by default) */
  versionValidator?: VersionValidator;
  /** Whether to automatically open when creating. Default is true. */
  autoOpen?: boolean;
  /** Advanced: auto-ack echo limit for ack.meta length (internal). */
  autoAckMaxMetaLength?: number;
  /** Advanced: auto-ack echo limit for ack.id length (internal). */
  autoAckMaxIdLength?: number;
}

/**
 * RequestIframeEndpointHub
 *
 * Endpoint "hub" responsible for:
 * - MessageDispatcher lifecycle
 * - handler registration/unregistration
 * - pending + timeout management
 * - limiter counters
 */
export class RequestIframeEndpointHub {
  public readonly hooks = {
    beforeOpen: new SyncHook<[]>(),
    afterOpen: new SyncHook<[]>(),
    beforeClose: new SyncHook<[]>(),
    afterClose: new SyncHook<[]>(),
    beforeDestroy: new SyncHook<[]>(),
    afterDestroy: new SyncHook<[]>(),
    registerHandler: new SyncHook<[matcher: MessageTypeMatcher]>(),
    unregisterHandler: new SyncHook<[]>()
  };

  public readonly messageDispatcher: MessageDispatcher;
  public readonly versionValidator: VersionValidator;
  public readonly pending = new RequestIframePendingManager();
  public readonly limiter = new RequestIframeLimiter(this.pending);
  public readonly instanceId?: string;

  private readonly unregisterFns: Array<() => void> = [];
  private registerHandlersFn?: () => void;
  private readonly warnOnceKeys = new Set<string>();
  private streamCallback?: (data: PostMessageData, context: MessageContext) => void;

  /** Whether it is open */
  private _isOpen = false;

  public constructor(
    role: MessageRoleValue,
    instanceId: string | undefined,
    options?: RequestIframeEndpointHubOptions
  ) {
    this.instanceId = instanceId;
    this.versionValidator = options?.versionValidator ?? isCompatibleVersion;

    /** Get or create shared channel and create dispatcher */
    const channel = getOrCreateMessageChannel(options?.secretKey);
    this.messageDispatcher = new MessageDispatcher(channel, role, instanceId);
    this.messageDispatcher.setAutoAckLimits({
      maxMetaLength: options?.autoAckMaxMetaLength,
      maxIdLength: options?.autoAckMaxIdLength
    });
  }

  /**
   * Set registerHandlers callback.
   *
   * This is used by composition-based implementations to define handler bindings.
   */
  public setRegisterHandlers(fn: () => void): void {
    this.registerHandlersFn = fn;
  }

  /**
   * Register a dispatcher handler and track its unregister function.
   */
  public registerHandler(
    matcher: MessageTypeMatcher,
    handler: MessageHandlerFn,
    options?: HandlerOptions | number
  ): () => void {
    this.hooks.registerHandler.call(matcher);
    const unreg = this.messageDispatcher.registerHandler(matcher, handler, options as any);
    this.unregisterFns.push(unreg);
    return unreg;
  }

  /**
   * Create common handler options object.
   */
  public createHandlerOptions(onVersionError: HandlerOptions['onVersionError']): HandlerOptions {
    return {
      versionValidator: this.versionValidator,
      onVersionError
    };
  }

  /**
   * Warn once per key.
   */
  public warnOnce(key: string, fn: () => void): void {
    if (this.warnOnceKeys.has(key)) return;
    this.warnOnceKeys.add(key);
    fn();
  }

  /**
   * Set stream callback (used by client-side stream routing).
   */
  public setStreamCallback(callback?: (data: PostMessageData, context: MessageContext) => void): void {
    this.streamCallback = callback;
  }

  /**
   * Get stream callback (used by handler registration side).
   */
  public getStreamCallback(): ((data: PostMessageData, context: MessageContext) => void) | undefined {
    return this.streamCallback;
  }

  /**
   * Validate origin safely (originValidator wins over origin string).
   */
  public isOriginAllowedBy(
    contextOrigin: string,
    data: PostMessageData,
    context: MessageContext,
    origin?: string,
    originValidator?: (origin: string, data: PostMessageData, context: MessageContext) => boolean
  ): boolean {
    if (originValidator) {
      try {
        return originValidator(contextOrigin, data, context);
      } catch {
        return false;
      }
    }
    if (!origin || origin === OriginConstant.ANY) return true;
    return contextOrigin === origin;
  }

  /**
   * Set a fixed peer (fallback target) for cases where MessageEvent.source is missing.
   *
   * This is useful for "response endpoint" style usage where the peer is already known
   * (e.g. a client bound to an iframe window).
   */
  public setFallbackTarget(targetWindow: Window, targetOrigin: string): void {
    this.messageDispatcher.setFallbackTarget(targetWindow, targetOrigin);
  }

  /**
   * Create a peer-bound outbox using this hub's dispatcher.
   */
  public createOutbox(
    targetWindow: Window,
    targetOrigin: string,
    defaultTargetId?: string
  ): RequestIframeEndpointOutbox {
    return new RequestIframeEndpointOutbox(this.messageDispatcher, targetWindow, targetOrigin, defaultTargetId);
  }

  /**
   * Open message processing (register message handlers)
   */
  public open(): void {
    if (this._isOpen) return;
    this.hooks.beforeOpen.call();
    this._isOpen = true;
    if (!this.registerHandlersFn) {
      throw new Error(Messages.HUB_REGISTER_HANDLERS_NOT_SET);
    }
    this.registerHandlersFn();
    this.hooks.afterOpen.call();
  }

  /**
   * Close message processing (unregister message handlers, but don't release channel)
   */
  public close(): void {
    if (!this._isOpen) return;
    this.hooks.beforeClose.call();
    this._isOpen = false;

    /** Unregister all handlers */
    this.unregisterFns.forEach(fn => fn());
    this.unregisterFns.length = 0;
    this.hooks.unregisterHandler.call();
    this.hooks.afterClose.call();
  }

  /**
   * Whether it is open
   */
  public get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Get secretKey
   */
  public get secretKey(): string | undefined {
    return this.messageDispatcher.secretKey;
  }

  /**
   * Destroy (close and release channel reference)
   */
  public destroy(): void {
    this.hooks.beforeDestroy.call();
    /** Close first */
    this.close();

    /** Clear all pending maps and timeouts */
    this.pending.clearAll();
    this.warnOnceKeys.clear();
    this.streamCallback = undefined;

    /** Destroy dispatcher and release channel reference */
    this.messageDispatcher.destroy();
    releaseMessageChannel(this.messageDispatcher.getChannel());
    this.hooks.afterDestroy.call();
  }
}

