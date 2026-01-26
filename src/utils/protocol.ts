import { PostMessageData } from '../types';
import { ProtocolVersion, ProtocolValidationResult, Messages, formatMessage } from '../constants';

/**
 * Validate protocol version
 * 
 * Only checks minimum supported version, not maximum version
 * Because new versions usually maintain backward compatibility with older message formats
 * 
 * @param version protocol version number
 * @returns validation result
 */
export function validateProtocolVersion(version: number): ProtocolValidationResult {
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return {
      valid: false,
      error: Messages.INVALID_PROTOCOL_VERSION_FORMAT,
      errorCode: 'INVALID_FORMAT'
    };
  }

  if (version < ProtocolVersion.MIN_SUPPORTED) {
    return {
      valid: false,
      version,
      error: formatMessage(Messages.PROTOCOL_VERSION_TOO_LOW, version, ProtocolVersion.MIN_SUPPORTED),
      errorCode: 'VERSION_TOO_LOW'
    };
  }

  // Don't check maximum version, new versions usually maintain backward compatibility
  return {
    valid: true,
    version
  };
}

/**
 * Validate PostMessage data format (full validation)
 * @param data data to validate
 * @returns validation result, including protocol version info
 */
export function validatePostMessage(data: any): ProtocolValidationResult & { data?: PostMessageData } {
  // Basic format validation
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      error: Messages.INVALID_MESSAGE_FORMAT_NOT_OBJECT,
      errorCode: 'INVALID_FORMAT'
    };
  }

  // Protocol identifier validation
  if (data.__requestIframe__ === undefined) {
    return {
      valid: false,
      error: Messages.INVALID_MESSAGE_FORMAT_MISSING_PROTOCOL,
      errorCode: 'INVALID_FORMAT'
    };
  }

  // Protocol version validation
  const versionResult = validateProtocolVersion(data.__requestIframe__);
  if (!versionResult.valid) {
    return versionResult;
  }

  // Required field validation
  if (typeof data.type !== 'string') {
    return {
      valid: false,
      version: versionResult.version,
      error: Messages.INVALID_MESSAGE_FORMAT_MISSING_TYPE,
      errorCode: 'INVALID_FORMAT'
    };
  }

  if (typeof data.requestId !== 'string') {
    return {
      valid: false,
      version: versionResult.version,
      error: Messages.INVALID_MESSAGE_FORMAT_MISSING_REQUEST_ID,
      errorCode: 'INVALID_FORMAT'
    };
  }

  return {
    valid: true,
    version: versionResult.version,
    data: data as PostMessageData
  };
}

/**
 * Check if data is a request-iframe framework message (only checks basic format, doesn't validate version compatibility)
 * @param data data to check
 * @returns whether it's a request-iframe message
 */
export function isRequestIframeMessage(data: any): boolean {
  return !!(
    data &&
    typeof data === 'object' &&
    typeof data.__requestIframe__ === 'number' &&
    typeof data.type === 'string' &&
    typeof data.requestId === 'string'
  );
}

/**
 * Create PostMessage data
 * @param type message type
 * @param requestId request ID
 * @param data additional data
 * @returns PostMessageData
 */
export function createPostMessage(
  type: PostMessageData['type'],
  requestId: string,
  data?: Partial<Omit<PostMessageData, '__requestIframe__' | 'type' | 'requestId' | 'timestamp'>>
): PostMessageData {
  return {
    __requestIframe__: ProtocolVersion.CURRENT,
    timestamp: Date.now(),
    type,
    requestId,
    ...data
  };
}

/**
 * Validate PostMessage data format (only checks basic format, doesn't validate version compatibility)
 * Used for quick determination of whether it's a request-iframe framework message
 * 
 * Note: This method doesn't check protocol version compatibility, use isCompatibleVersion for version compatibility check
 * 
 * @param data data to validate
 * @returns whether it's a valid PostMessageData
 */
export function isValidPostMessage(data: any): data is PostMessageData {
  return !!(
    data &&
    typeof data === 'object' &&
    typeof data.__requestIframe__ === 'number' &&
    typeof data.type === 'string' &&
    typeof data.requestId === 'string'
  );
}

/**
 * Get protocol version from message
 * @param data PostMessageData
 * @returns protocol version number, undefined if invalid
 */
export function getProtocolVersion(data: any): number | undefined {
  if (data && typeof data === 'object' && typeof data.__requestIframe__ === 'number') {
    return data.__requestIframe__;
  }
  return undefined;
}

/**
 * Check if protocol version is compatible
 * 
 * Only checks minimum supported version, not maximum version
 * Because new versions usually maintain backward compatibility with older message formats
 * 
 * @param version protocol version number
 * @returns whether compatible
 */
export function isCompatibleVersion(version: number): boolean {
  return version >= ProtocolVersion.MIN_SUPPORTED;
}
