export { generateRequestId, generateInstanceId } from './id';
export { getIframeTargetOrigin } from './iframe';
export { isPromise } from './promise';
export { isFunction } from './is';

export { isWindowAvailable } from './window';
export { detectContentType } from './content-type';
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

// NOTE:
// Cache helpers are intentionally NOT re-exported here.
// - Server cache is an internal API and should be imported from `./cache` explicitly.
// - MessageChannel cache lives in `src/message/channel-cache.ts`.

// Export path matching functions
export * from './path-match';

// Export origin matching functions
export * from './origin';

// ack is a reserved protocol field (internal). Do not export helpers publicly.

// Export Cookie-related functions
export * from './cookie';

// Export Error class
export { RequestIframeError } from './error';

export { blobToBase64 } from './blob';
