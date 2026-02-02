/**
 * Check if target window is still available (not closed/removed)
 * @param targetWindow Target window to check
 * @returns true if window is available, false otherwise
 */
import { isFunction } from './is';

export function isWindowAvailable(targetWindow: Window | null | undefined): boolean {
  if (!targetWindow) {
    return false;
  }

  try {
    /** Must have postMessage to be a usable target */
    if (!isFunction((targetWindow as any).postMessage)) {
      return false;
    }

    /** For windows opened via window.open(), check closed property */
    if ('closed' in targetWindow && (targetWindow as any).closed === true) {
      return false;
    }

    /**
     * Avoid touching cross-origin properties (like document) which may throw.
     * If closed is not true and postMessage exists, treat as available.
     */
    return true;
  } catch (e) {
    /** If accessing window properties throws an error, window is likely closed */
    return false;
  }
}

