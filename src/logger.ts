/**
 * Structured Logging Module
 *
 * Provides pino-based structured logging with scoped child loggers.
 * Supports JSON output for production and pretty-printing for development.
 */

import pino, { Logger } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerConfig {
  level?: LogLevel;
  pretty?: boolean;
}

let rootLogger: Logger | null = null;

/**
 * Initialize the root logger. Call once at startup.
 */
export function initLogger(config: LoggerConfig = {}): void {
  const level = config.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  const pretty = config.pretty ?? process.env.NODE_ENV !== 'production';

  if (pretty) {
    rootLogger = pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[{module}] {msg}',
        },
      },
    });
  } else {
    rootLogger = pino({ level });
  }
}

/**
 * Get a scoped logger for a specific module.
 * Auto-initializes if not already initialized.
 */
export function getLogger(module: string): Logger {
  if (!rootLogger) {
    initLogger();
  }
  return rootLogger!.child({ module });
}

/**
 * Get the root logger instance.
 */
export function getRootLogger(): Logger {
  if (!rootLogger) {
    initLogger();
  }
  return rootLogger!;
}
