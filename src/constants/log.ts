/**
 * Log level constants for request-iframe.
 */

export const LogLevel = {
  TRACE: 'trace',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SILENT: 'silent'
} as const;

export type LogLevelValue = typeof LogLevel[keyof typeof LogLevel];

