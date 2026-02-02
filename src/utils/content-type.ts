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

  /** Stream - handled separately (only for response) */
  if (checkStream && isIframeWritableStream) {
    if (isIframeWritableStream(data)) {
      return null; /** Stream will be handled by sendStream */
    }
  }

  /** File */
  if (typeof File !== 'undefined' && data instanceof File) {
    return data.type || 'application/octet-stream';
  }

  /** Blob */
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.type || 'application/octet-stream';
  }

  /** ArrayBuffer */
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return 'application/octet-stream';
  }

  /** FormData */
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    /** FormData typically doesn't need Content-Type header (browser sets it with boundary) */
    return null;
  }

  /** URLSearchParams */
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return 'application/x-www-form-urlencoded';
  }

  /** String - check if it's JSON string */
  if (typeof data === 'string') {
    /** Try to parse as JSON, if successful, treat as JSON */
    try {
      JSON.parse(data);
      return 'application/json';
    } catch {
      return 'text/plain; charset=utf-8';
    }
  }

  /** Number, boolean - treat as JSON */
  if (typeof data === 'number' || typeof data === 'boolean') {
    return 'application/json';
  }

  /** Plain object or array - treat as JSON */
  if (typeof data === 'object') {
    /**
     * Exclude common binary/file types (already checked above, but double-check for safety)
     */
    if (typeof Blob !== 'undefined' && data instanceof Blob) return null;
    if (typeof File !== 'undefined' && data instanceof File) return null;
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return null;
    if (typeof FormData !== 'undefined' && data instanceof FormData) return null;
    if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return null;
    return 'application/json';
  }

  return null;
}

