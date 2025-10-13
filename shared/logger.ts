type LogInput = Record<string, unknown> | undefined;

export type Logger = {
  info: (details?: LogInput, message?: string) => void;
  warn: (details?: LogInput, message?: string) => void;
  error: (details?: LogInput, message?: string) => void;
  debug?: (details?: LogInput, message?: string) => void;
};

export function createConsoleLogger(prefix?: string): Logger {
  const withPrefix = (message?: string) =>
    prefix && message ? `${prefix} ${message}` : prefix ?? message;

  const serialize = (details?: LogInput) => {
    if (!details) {
      return [];
    }
    return [details];
  };

  return {
    info(details, message) {
      console.info(withPrefix(message), ...serialize(details));
    },
    warn(details, message) {
      console.warn(withPrefix(message), ...serialize(details));
    },
    error(details, message) {
      console.error(withPrefix(message), ...serialize(details));
    },
    debug(details, message) {
      console.debug(withPrefix(message), ...serialize(details));
    },
  };
}

export function ensureLogger(logger?: Logger): Logger {
  return logger ?? createConsoleLogger();
}
