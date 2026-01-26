/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Derive targetOrigin from iframe.src
 */
export function getIframeTargetOrigin(iframe: HTMLIFrameElement): string {
  if (!iframe.src) {
    return '*';
  }
  try {
    return new URL(iframe.src).origin;
  } catch (e) {
    return '*';
  }
}

// Export protocol-related functions
export {
  createPostMessage,
  isValidPostMessage,
  validatePostMessage,
  validateProtocolVersion,
  isRequestIframeMessage,
  getProtocolVersion,
  isCompatibleVersion
} from './protocol';

// Export cache-related functions
export * from './cache';

// Export path matching functions
export * from './path-match';

// Export Cookie-related functions
export * from './cookie';
