import { Logger, type ILogObj } from 'tslog';
import type { LoggingConfig } from './types';

const LEVELS = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
} as const;

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

/**
 * Builds the SDK's logger (tslog), at the default level and format — see
 * {@link configureLogger}. Logs to stdout/console out of the box in both Node
 * and the browser.
 *
 * The instance is exposed publicly as `NexxusClient.logger`, so consumers can
 * attach more transports for their environment — e.g. a file sink in Node, or
 * shipping logs to a remote service in the browser — via
 * `logger.attachTransport(...)`.
 */
export function createLogger(): Logger<ILogObj> {
  const logger = new Logger<ILogObj>({
    name: 'nexxus',
    // Skip per-log caller stack capture — it's a hot-path cost under load and
    // only points into SDK internals anyway.
    stylePrettyLogs: false,
    hideLogPositionForProduction: true,
    overwrite: {
      // Flatten tslog's positional JSON ({ "0": msg, "1": attrs, _meta }) into a
      // jq-friendly record: { ...attrs, timestamp(ms), level, name, message }.
      // Only affects JSON output — pretty/text and attached transports are untouched.
      transportJSON: (logObj) => {
        const obj = logObj as Record<string, any>;
        const meta = obj._meta ?? {};
        const attrs: Record<string, unknown> = {};
        const messages: string[] = [];

        for (const key of Object.keys(obj)) {
          if (key === '_meta') {
            continue;
          }

          const value = obj[key];

          if (typeof value === 'string') {
            messages.push(value);
          } else if (value !== null && typeof value === 'object') {
            Object.assign(attrs, value);
          } else {
            attrs[key] = value;
          }
        }

        const record = {
          ...attrs,
          timestamp: meta.date ? new Date(meta.date).getTime() : Date.now(),
          level: typeof meta.logLevelName === 'string' ? meta.logLevelName.toLowerCase() : undefined,
          name: meta.name,
          message: messages.join(' '),
        };

        console.log(JSON.stringify(record));
      },
    },
  });

  configureLogger(logger, {});

  return logger;
}

/**
 * Set the logger's level and format from a client's `logging` config. tslog
 * reads both on every call, so a logger already in use follows at once.
 * Defaults: `'text'` (pretty) in the browser for readability, `'json'` in
 * Node; minimum level `'info'`.
 */
export function configureLogger(logger: Logger<ILogObj>, config: LoggingConfig): void {
  const format = config.format ?? (isBrowser ? 'text' : 'json');

  logger.settings.type = format === 'text' ? 'pretty' : 'json';
  logger.settings.minLevel = LEVELS[config.level ?? 'info'];
}
