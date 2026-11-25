/**
 * Structured Logger for Serverless Cloud Functions (Issue #89).
 * 
 * Enforces:
 * 1. Consistent structured JSON fields aligned with docs/events.md.
 * 2. Guaranteed correlation ID propagation across all hops.
 * 3. Strict redaction preventing tokens, credentials, or sensitive payloads from leaking to logs.
 */

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LogContext {
  correlationId?: string | undefined;
  eventId?: string | undefined;
  eventType?: string | undefined;
  source?: string | undefined;
  functionName?: string | undefined;
  userId?: string | undefined;
}

export interface StructuredLogEntry extends LogContext {
  severity: LogSeverity;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  functionName: string;
  defaultContext?: LogContext | undefined;
  outputStream?: ((line: string) => void) | undefined;
}

/**
 * Keys that must NEVER be logged in plain text.
 */
const SENSITIVE_KEY_PATTERNS = [
  /^token$/i,
  /(access|refresh|auth|bot|session|id|bearer|client|api)[_-]?token/i,
  /authorization/i,
  /secret/i,
  /password/i,
  /cookie/i,
  /signature/i,
  /private_key/i,
  /credential/i,
  /(oauth)?[_-]?code$/i,
];

/**
 * Recursively redacts sensitive keys and values from logging metadata.
 */
export function sanitizeLogData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact bearer tokens if embedded in a string
    if (data.toLowerCase().startsWith('bearer ')) {
      return '[REDACTED]' as unknown as T;
    }
    // Redact suspected long hex / base64 hashes or secrets
    if (/^[a-zA-Z0-9_-]{50,}$/.test(data) && !data.includes(' ')) {
      return '[REDACTED]' as unknown as T;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitizeLogData(value);
      }
    }
    return sanitizedObj as T;
  }

  return data;
}

export class StructuredLogger {
  private readonly functionName: string;
  private readonly context: LogContext;
  private readonly output: (line: string) => void;

  constructor(options: LoggerOptions) {
    this.functionName = options.functionName;
    this.context = options.defaultContext || {};
    this.output = options.outputStream || console.log;
  }

  public withContext(additionalContext: Partial<LogContext>): StructuredLogger {
    return new StructuredLogger({
      functionName: this.functionName,
      defaultContext: { ...this.context, ...additionalContext },
      outputStream: this.output,
    });
  }

  public log(severity: LogSeverity, message: string, meta?: Record<string, unknown>): StructuredLogEntry {
    const sanitizedMeta = meta ? sanitizeLogData(meta) : {};

    const entry: StructuredLogEntry = {
      severity,
      message,
      timestamp: new Date().toISOString(),
      functionName: this.functionName,
      ...this.context,
      ...sanitizedMeta,
    };

    this.output(JSON.stringify(entry));
    return entry;
  }

  public info(message: string, meta?: Record<string, unknown>): StructuredLogEntry {
    return this.log('INFO', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): StructuredLogEntry {
    return this.log('WARNING', message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): StructuredLogEntry {
    return this.log('ERROR', message, meta);
  }

  public debug(message: string, meta?: Record<string, unknown>): StructuredLogEntry {
    return this.log('DEBUG', message, meta);
  }
}

export function createStructuredLogger(functionName: string, initialContext?: LogContext): StructuredLogger {
  return new StructuredLogger({ functionName, defaultContext: initialContext });
}
