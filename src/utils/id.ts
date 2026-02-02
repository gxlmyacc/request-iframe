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

