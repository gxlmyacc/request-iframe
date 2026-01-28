/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate unique instance ID
 */
export function generateInstanceId(): string {
  return `inst_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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


export function isPromise<T>(value: any): value is Promise<T>  {
  return value !== null && typeof value === 'object' && 'then' in value;
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

/**
 * Detect Content-Type based on data type
 * @param data The data to detect Content-Type for
 * @param options Options for detection
 * @param options.checkStream Whether to check for IframeWritableStream (default: false)
 * @param options.isIframeWritableStream Optional function to check if data is a stream (required if checkStream is true)
 * @returns The detected Content-Type, or null if Content-Type should not be auto-set
 */
export function detectContentType(
  data: any,
  options?: { checkStream?: boolean; isIframeWritableStream?: (value: any) => boolean }
): string | null {
  if (data === null || data === undefined) return null;

  const { checkStream = false, isIframeWritableStream } = options || {};

  // Stream - handled separately (only for response)
  if (checkStream && isIframeWritableStream) {
    if (isIframeWritableStream(data)) {
      return null; // Stream will be handled by sendStream
    }
  }

  // File
  if (typeof File !== 'undefined' && data instanceof File) {
    return data.type || 'application/octet-stream';
  }

  // Blob
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.type || 'application/octet-stream';
  }

  // ArrayBuffer
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return 'application/octet-stream';
  }

  // FormData
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    // FormData typically doesn't need Content-Type header (browser sets it with boundary)
    return null;
  }

  // URLSearchParams
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return 'application/x-www-form-urlencoded';
  }

  // String - check if it's JSON string
  if (typeof data === 'string') {
    // Try to parse as JSON, if successful, treat as JSON
    try {
      JSON.parse(data);
      return 'application/json';
    } catch {
      return 'text/plain; charset=utf-8';
    }
  }

  // Number, boolean - treat as JSON
  if (typeof data === 'number' || typeof data === 'boolean') {
    return 'application/json';
  }

  // Plain object or array - treat as JSON
  if (typeof data === 'object') {
    // Exclude common binary/file types (already checked above, but double-check for safety)
    if (typeof Blob !== 'undefined' && data instanceof Blob) return null;
    if (typeof File !== 'undefined' && data instanceof File) return null;
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return null;
    if (typeof FormData !== 'undefined' && data instanceof FormData) return null;
    if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return null;
    return 'application/json';
  }

  return null;
}

/** Convert Blob to base64 string */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
