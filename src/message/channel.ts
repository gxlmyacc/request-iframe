import {
  PostMessageData
} from '../types';
import { isValidPostMessage, createPostMessage } from '../utils/protocol';
import { isWindowAvailable } from '../utils/window';
import { OriginConstant } from '../constants';
import { requestIframeLog } from '../utils/logger';
import { SyncHook } from '../utils/hooks';

/**
 * Message context (extracted from MessageEvent, transport-agnostic)
 */
export const MessageContextStage = {
  /** Message is not handled by any instance yet */
  PENDING: 'pending',
  /** Message is claimed/being handled (handledBy is set, but not accepted) */
  HANDLING: 'handling',
  /** Message is accepted for processing (acceptedBy is set) */
  ACCEPTED: 'accepted',
  /** Message handling finished (synchronous dispatch finished) */
  DONE: 'done'
} as const;

export type MessageContextStage = typeof MessageContextStage[keyof typeof MessageContextStage];

export interface MessageContext {
  /** Source window (where the message came from) */
  source?: Window;
  /** Origin of the message */
  origin: string;
  /** Which instance accepted this message for processing (if accepted) */
  acceptedBy?: string;
  /** ID of the instance that handled this message (if handled) */
  handledBy?: string;
  /** Which instance marked this message as done (if any) */
  doneBy?: string;
  /**
   * Mark a message as handled by the given instance id.
   *
   * Notes:
   * - This method is attached by MessageChannel and is non-enumerable.
   */
  markHandledBy: (handledBy: string) => void;
  /**
   * Mark a message as accepted for processing and mark it as handled by the given instance id.
   *
   * Notes:
   * - This method is attached by MessageChannel and is non-enumerable.
   */
  markAcceptedBy: (handledBy: string) => void;
  /**
   * Mark the message synchronous dispatch as finished.
   *
   * Notes:
   * - This method is attached by MessageChannel and is non-enumerable.
   */
  markDoneBy: (doneBy: string) => void;
  /**
   * Get current derived stage of this message.
   *
   * Stage is derived from:
   * - doneBy
   * - acceptedBy
   * - handledBy
   */
  getStage: () => MessageContextStage;

  /**
   * Subscribe to state changes (derived from handledBy/acceptedBy/doneBy).
   *
   * @param name tap name (for debugging)
   * @param fn callback(prev, next, context)
   * @returns unsubscribe function
   */
  onStateChange: (
    name: string,
    fn: (prev: MessageContextStage, next: MessageContextStage, context: MessageContext) => void
  ) => () => void;
}

/**
 * Message receiver callback
 */
export type MessageReceiver = (data: PostMessageData, context: MessageContext) => void;

/**
 * Channel type constants
 */
export const ChannelType = {
  /** postMessage channel type */
  POST_MESSAGE: 'postMessage'
} as const;

/**
 * Channel type
 */
export type ChannelType = typeof ChannelType[keyof typeof ChannelType];

/**
 * MessageChannel - Low-level communication channel for postMessage
 * 
 * Responsibilities:
 * - Listening to window.postMessage events
 * - Filtering messages by secretKey
 * - Extracting transport-specific information (MessageEvent) into generic MessageContext
 * - Forwarding received messages to registered receivers
 * - Sending messages to target windows
 * 
 * This is the low-level communication layer that handles postMessage directly.
 * All transport-specific details (like MessageEvent) are encapsulated here.
 */
export class MessageChannel {
  /** Channel type (used for cache isolation) */
  public readonly type: ChannelType;
  
  /** Secret key for message isolation */
  public readonly secretKey?: string;
  
  /** Message receiver callbacks (support multiple receivers) */
  private receivers: Set<MessageReceiver> = new Set();
  
  /** Message listener function (bound to this) */
  private readonly boundOnMessage: (event: MessageEvent) => void;

  /** Reference count (for cache management) */
  private refCount = 0;

  public constructor(secretKey?: string, type: ChannelType = ChannelType.POST_MESSAGE) {
    this.type = type;
    this.secretKey = secretKey;
    this.boundOnMessage = this.onMessage.bind(this);
    window.addEventListener('message', this.boundOnMessage);
  }

  /**
   * Add message receiver callback
   * When a message is received, it will be forwarded to all registered receivers
   */
  public addReceiver(receiver: MessageReceiver): void {
    this.receivers.add(receiver);
  }

  /**
   * Remove message receiver callback
   */
  public removeReceiver(receiver: MessageReceiver): void {
    this.receivers.delete(receiver);
  }

  /**
   * Increment reference count (for cache management)
   */
  public addRef(): void {
    this.refCount++;
  }

  /**
   * Decrement reference count (for cache management)
   * @returns current reference count
   */
  public release(): number {
    return --this.refCount;
  }

  /**
   * Get reference count (for cache management)
   */
  public getRefCount(): number {
    return this.refCount;
  }

  /**
   * Extract MessageContext from MessageEvent
   * This encapsulates transport-specific details
   */
  private extractContext(event: MessageEvent): MessageContext {
    const context = {
      source: (event.source as Window | null) ?? undefined,
      origin: event.origin
    } as unknown as MessageContext;

    let stateChangeHook: SyncHook<[prev: MessageContextStage, next: MessageContextStage, context: MessageContext]> | undefined;

    const ensureStateChangeHook = () => {
      if (!stateChangeHook) {
        stateChangeHook = new SyncHook<[prev: MessageContextStage, next: MessageContextStage, context: MessageContext]>();
      }
      return stateChangeHook;
    };

    const emitStateChange = (prev: MessageContextStage, next: MessageContextStage) => {
      if (!stateChangeHook) return;
      stateChangeHook.call(prev, next, context);
    };

    /**
     * Attach stable internal helper methods.
     *
     * We intentionally make them non-enumerable so typical object inspection won't be polluted.
     */
    const markHandledBy = (handledBy: string) => {
      const prev = getStage();
      if (!context.handledBy) {
        context.handledBy = handledBy;
      }
      const next = getStage();
      if (prev !== next) emitStateChange(prev, next);
    };
    const markAcceptedBy = (handledBy: string) => {
      const prev = getStage();
      if (!context.acceptedBy) {
        context.acceptedBy = handledBy;
      }
      markHandledBy(handledBy);
      const next = getStage();
      if (prev !== next) emitStateChange(prev, next);
    };
    const markDoneBy = (doneBy: string) => {
      const prev = getStage();
      if (!context.doneBy) {
        context.doneBy = doneBy;
      }
      const next = getStage();
      if (prev !== next) emitStateChange(prev, next);
    };
    const getStage = (): MessageContextStage => {
      if (context.doneBy) return MessageContextStage.DONE;
      if (context.acceptedBy) return MessageContextStage.ACCEPTED;
      if (context.handledBy) return MessageContextStage.HANDLING;
      return MessageContextStage.PENDING;
    };
    const onStateChange: MessageContext['onStateChange'] = (name, fn) => {
      return ensureStateChangeHook().tap(name, fn);
    };
    Object.defineProperty(context, 'markHandledBy', {
      value: markHandledBy,
      enumerable: false
    });
    Object.defineProperty(context, 'markAcceptedBy', {
      value: markAcceptedBy,
      enumerable: false
    });
    Object.defineProperty(context, 'markDoneBy', {
      value: markDoneBy,
      enumerable: false
    });
    Object.defineProperty(context, 'getStage', {
      value: getStage,
      enumerable: false
    });
    Object.defineProperty(context, 'onStateChange', {
      value: onStateChange,
      enumerable: false
    });

    return context;
  }

  /**
   * Message handling entry point
   */
  private onMessage(event: MessageEvent): void {
    const data = event.data;
    
    // Check if this is a request-iframe framework message (basic format validation)
    if (!isValidPostMessage(data)) {
      return;
    }

    // secretKey isolation
    if (this.secretKey) {
      if (data.secretKey !== this.secretKey) return;
    } else {
      if (data.secretKey) return;
    }

    // Extract context from transport-specific event
    const context = this.extractContext(event);

    // Forward to all registered receivers
    this.receivers.forEach(receiver => {
      try {
        receiver(data, context);
      } catch (e) {
        requestIframeLog('error', 'Receiver error', e);
      }
    });
  }

  /**
   * Send raw message to target window
   * @param target target window
   * @param message message data (already formatted as PostMessageData)
   * @param targetOrigin target origin (defaults to '*')
   */
  public send(target: Window, message: PostMessageData, targetOrigin: string = OriginConstant.ANY): boolean {
    if (!isWindowAvailable(target)) {
      return false;
    }
    target.postMessage(message, targetOrigin);
    return true;
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
    data?: Partial<Omit<PostMessageData, '__requestIframe__' | 'type' | 'requestId' | 'timestamp' | 'role'>>
  ): boolean {
    const message = createPostMessage(type, requestId, {
      ...data,
      secretKey: this.secretKey
    });
    return this.send(target, message, targetOrigin);
  }

  /**
   * Add path prefix (for secretKey isolation)
   */
  public prefixPath(path: string): string {
    return this.secretKey ? `${this.secretKey}:${path}` : path;
  }

  /**
   * Destroy channel (remove event listener)
   */
  public destroy(): void {
    window.removeEventListener('message', this.boundOnMessage);
    this.receivers.clear();
  }
}
