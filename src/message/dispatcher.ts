import { MessageRole, MessageRoleValue } from '../constants';
import {
  PostMessageData
} from '../types';
import { getProtocolVersion, createPostMessage } from '../utils';
import { MessageChannel, type MessageContext } from './channel';

/**
 * Message handler function type
 */
export type MessageHandlerFn = (data: PostMessageData, context: MessageContext) => void;

/**
 * Message type matcher
 * - string: exact match message type
 * - RegExp: regex match message type
 * - function: custom match function
 */
export type MessageTypeMatcher = string | RegExp | ((type: string) => boolean);

/**
 * Protocol version validator function
 * @param version protocol version in message
 * @returns true if version is compatible, false otherwise
 */
export type VersionValidator = (version: number) => boolean;

/**
 * Message handler registration options
 */
export interface HandlerOptions {
  /** Priority (higher number = higher priority, default 0) */
  priority?: number;
  /** Protocol version validator (optional, no validation if not provided) */
  versionValidator?: VersionValidator;
  /** Error handler when version is incompatible (optional) */
  onVersionError?: (data: PostMessageData, context: MessageContext, version: number) => void;
}

/**
 * Message handler entry
 */
interface MessageHandlerEntry {
  /** Matcher */
  matcher: MessageTypeMatcher;
  /** Handler */
  handler: MessageHandlerFn;
  /** Priority (higher number = higher priority, default 0) */
  priority: number;
  /** Protocol version validator */
  versionValidator?: VersionValidator;
  /** Error handler when version is incompatible */
  onVersionError?: (data: PostMessageData, context: MessageContext, version: number) => void;
}

/**
 * MessageDispatcher - Message dispatcher for client/server interaction
 * 
 * Responsibilities:
 * - Using MessageChannel for receiving and sending messages
 * - Dispatching received messages to registered handlers
 * - Managing handler registration/unregistration
 * - Protocol version validation
 * 
 * This is the high-level interface used by client and server implementations.
 * It works with transport-agnostic MessageContext instead of transport-specific MessageEvent.
 */
export class MessageDispatcher {
  /** Secret key for message isolation */
  public readonly secretKey?: string;
  
  /** Channel type */
  public readonly type: MessageChannel['type'];
  
  /** Role of this dispatcher ('client' or 'server') */
  private readonly role: MessageRoleValue;
  
  /** Instance ID of the client/server that owns this dispatcher */
  private readonly instanceId?: string;
  
  /** Underlying message channel */
  private readonly channel: MessageChannel;
  
  /** Message handler list */
  private readonly handlers: MessageHandlerEntry[] = [];

  /** Message receiver callback (bound to this) */
  private readonly boundReceiver: (data: PostMessageData, context: MessageContext) => void;

  /** Reference count (for determining if can be destroyed when cached) */
  private refCount = 0;

  public constructor(channel: MessageChannel, role: MessageRoleValue, instanceId?: string) {
    this.channel = channel;
    this.secretKey = channel.secretKey;
    this.type = channel.type;
    this.role = role;
    this.instanceId = instanceId;
    
    // Create bound receiver callback
    this.boundReceiver = (data, context) => {
      this.dispatchMessage(data, context);
    };
    
    // Add receiver callback to handle incoming messages
    this.channel.addReceiver(this.boundReceiver);
  }

  // ==================== Reference Counting ====================

  /**
   * Increment reference count
   */
  public addRef(): void {
    this.refCount++;
  }

  /**
   * Decrement reference count
   * @returns current reference count
   */
  public release(): number {
    return --this.refCount;
  }

  /**
   * Get reference count
   */
  public getRefCount(): number {
    return this.refCount;
  }

  // ==================== Message Handling ====================

  /**
   * Register message handler
   * @param matcher message type matcher
   * @param handler handler function
   * @param options registration options (priority, version validation, etc.)
   * @returns function to unregister
   */
  public registerHandler(
    matcher: MessageTypeMatcher,
    handler: MessageHandlerFn,
    options?: HandlerOptions | number  // Compatible with old API (passing priority number directly)
  ): () => void {
    const opts: HandlerOptions = typeof options === 'number' 
      ? { priority: options } 
      : (options || {});
    
    const entry: MessageHandlerEntry = {
      matcher,
      handler,
      priority: opts.priority ?? 0,
      versionValidator: opts.versionValidator,
      onVersionError: opts.onVersionError
    };
    
    this.handlers.push(entry);
    // Sort by priority in descending order
    this.handlers.sort((a, b) => b.priority - a.priority);
    
    return () => {
      const index = this.handlers.indexOf(entry);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * Unregister message handler
   */
  public unregisterHandler(handler: MessageHandlerFn): void {
    const index = this.handlers.findIndex(entry => entry.handler === handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Dispatch message to matching handlers
   */
  private dispatchMessage(data: PostMessageData, context: MessageContext): void {
    // If message has already been handled by another dispatcher, skip processing
    if (context.handledBy) {
      return;
    }

    // Role-based message filtering: only process messages from the opposite role
    // - Server only processes messages from client (role === 'client')
    // - Client only processes messages from server (role === 'server')
    if (data.role !== undefined) {
      const expectedRole = this.role === MessageRole.CLIENT 
        ? MessageRole.SERVER 
        : MessageRole.CLIENT;
      if (data.role !== expectedRole) {
        // Message is from the same role, ignore it to prevent routing confusion
        return;
      }
    }

    const type = data.type as string;
    const version = getProtocolVersion(data);

    for (const entry of this.handlers) {
      if (this.matchType(type, entry.matcher)) {
        // If message has been handled by a previous handler, stop processing
        if (context.handledBy) {
          break;
        }

        // If handler specified version validation
        if (entry.versionValidator && version !== undefined) {
          if (!entry.versionValidator(version)) {
            // Version incompatible, call error handler (if any)
            entry.onVersionError?.(data, context, version);
            continue;  // Skip this handler, try other handlers
          }
        }
        
        try {
          entry.handler(data, context);
          // After handler execution, check if it marked the message as handled
          // If context.handledBy is set by the handler, subsequent handlers will be skipped
        } catch (e) {
          // Ignore handler exception, continue executing other handlers
          console.error('[request-iframe] Handler error:', e);
        }
      }
    }
  }

  /**
   * Check if message type matches
   */
  private matchType(type: string, matcher: MessageTypeMatcher): boolean {
    if (typeof matcher === 'string') {
      return type === matcher;
    }
    if (matcher instanceof RegExp) {
      return matcher.test(type);
    }
    if (typeof matcher === 'function') {
      return matcher(type);
    }
    return false;
  }

  // ==================== Sending (Delegated to Channel) ====================

  /**
   * Send raw message to target window
   * @param target target window
   * @param message message data (already formatted as PostMessageData)
   * @param targetOrigin target origin (defaults to '*')
   */
  public send(target: Window, message: PostMessageData, targetOrigin: string = '*'): void {
    // Automatically set role and creatorId if not already set (for backward compatibility)
    if (message.role === undefined) {
      message.role = this.role;
    }
    if (message.creatorId === undefined && this.instanceId) {
      message.creatorId = this.instanceId;
    }
    this.channel.send(target, message, targetOrigin);
  }

  /**
   * Send typed message to target window (creates PostMessageData automatically)
   * @param target target window
   * @param targetOrigin target origin
   * @param type message type
   * @param requestId request ID
   * @param data additional data
   */
  public sendMessage(
    target: Window,
    targetOrigin: string,
    type: PostMessageData['type'],
    requestId: string,
    data?: Partial<Omit<PostMessageData, '__requestIframe__' | 'type' | 'requestId' | 'timestamp' | 'role' | 'creatorId'>>
  ): void {
    // Automatically set role, creatorId, and secretKey based on dispatcher's properties
    // Create message with role, creatorId, and secretKey using createPostMessage directly
    const message = createPostMessage(type, requestId, {
      ...data,
      role: this.role,
      creatorId: this.instanceId,
      secretKey: this.secretKey
    } as any);
    this.channel.send(target, message, targetOrigin);
  }

  // ==================== Utilities ====================

  /**
   * Add path prefix
   */
  public prefixPath(path: string): string {
    return this.channel.prefixPath(path);
  }

  /**
   * Get the underlying message channel
   */
  public getChannel(): MessageChannel {
    return this.channel;
  }

  /**
   * Destroy dispatcher (clear handlers, but don't destroy channel as it may be shared)
   */
  public destroy(): void {
    this.handlers.length = 0;
    this.channel.removeReceiver(this.boundReceiver);
  }
}
