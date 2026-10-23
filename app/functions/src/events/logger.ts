export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warning(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  /** Name of the function that writes the lines. */
  readonly functionName: string;
  /** Present from the proxy onwards, so one request can be followed end to end. */
  readonly correlationId?: string;
  /** Receives one JSON line per entry; stdout by default, which Cloud Logging collects. */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
  readonly fields?: LogFields;
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Writes structured JSON lines. `severity` and `message` are the names Cloud Logging reads; the
 * correlation ID is always `correlation_id`. Callers pass explicit fields: a payload or an
 * interaction token must never be logged wholesale.
 */
export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? writeToStdout;
  const now = options.now ?? (() => new Date());
  const inherited = options.fields ?? {};

  function log(severity: Severity, message: string, fields: LogFields | undefined): void {
    const entry = {
      ...inherited,
      ...fields,
      severity,
      message,
      function: options.functionName,
      ...(options.correlationId === undefined ? {} : { correlation_id: options.correlationId }),
      timestamp: now().toISOString(),
    };
    write(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => { log("DEBUG", message, fields); },
    info: (message, fields) => { log("INFO", message, fields); },
    warning: (message, fields) => { log("WARNING", message, fields); },
    error: (message, fields) => { log("ERROR", message, fields); },
    child: (fields) => createLogger({ ...options, fields: { ...inherited, ...fields } }),
  };
}
