import type { RequestIframeLogLevel } from '../types';
import { LogLevel } from '../constants';

/**
 * Built-in leveled logger for request-iframe.
 *
 * - Default level is 'warn' (prints warn/error only)
 * - Trace/debug tools can raise to 'info' or 'trace'
 */

const DEBUG_PREFIX = '[request-iframe]';

const levelOrder: Record<RequestIframeLogLevel, number> = {
  [LogLevel.TRACE]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.SILENT]: 100
};

let currentLevel: RequestIframeLogLevel = LogLevel.WARN;

export function getRequestIframeLogLevel(): RequestIframeLogLevel {
  return currentLevel;
}

export function setRequestIframeLogLevel(level: RequestIframeLogLevel): void {
  currentLevel = level;
}

/**
 * Ensure current log level is at least as verbose as `level`.
 * - Example: current 'warn' + ensure 'trace' => becomes 'trace'
 */
export function ensureRequestIframeLogLevel(level: RequestIframeLogLevel): void {
  if (levelOrder[level] < levelOrder[currentLevel]) {
    currentLevel = level;
  }
}

function shouldLog(level: RequestIframeLogLevel): boolean {
  return levelOrder[level] >= levelOrder[currentLevel];
}

/**
 * Log with level gating + unified prefix.
 */
export function requestIframeLog(level: Exclude<RequestIframeLogLevel, 'silent'>, message: string, data?: unknown): void {
  if (currentLevel === LogLevel.SILENT) return;
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const prefix = `${DEBUG_PREFIX} [${timestamp}] [${level.toUpperCase()}]`;

  const prefixStyle = 'font-weight:bold';
  const messageStyle = level === LogLevel.INFO ? 'color: #1976d2' : '';

  const method: 'debug' | 'info' | 'warn' | 'error' =
    level === LogLevel.TRACE ? 'debug' : (level as any);

  if (data !== undefined) {
    (console as any)[method](`%c${prefix}%c ${message}`, prefixStyle, messageStyle, data);
  } else {
    (console as any)[method](`%c${prefix}%c ${message}`, prefixStyle, messageStyle);
  }
}

