export type Severity = 'INFO' | 'ERROR';

// The only fields a log line may carry. A token, a header or a request body has no place here:
// anything else passed in is dropped, so it cannot reach Cloud Logging.
const ALLOWED_FIELDS = ['correlation_id', 'path', 'error'] as const;

export type LogFields = { correlation_id: string } & { [K in 'path' | 'error']?: string };

// Cloud Logging links a line to a trace when this field holds projects/PROJECT/traces/TRACE_ID.
const TRACE_FIELD = 'logging.googleapis.com/trace';

// The x-cloud-trace-context header looks like TRACE_ID/SPAN_ID;o=1.
export function traceName(header: string | undefined, projectId: string): string | undefined {
  const traceId = header?.split('/')[0];
  if (!traceId || !projectId) return undefined;
  return `projects/${projectId}/traces/${traceId}`;
}

// One JSON object per line: Cloud Logging reads `severity` and indexes the other fields,
// so logs can be searched by correlation_id.
export function logLine(
  severity: Severity,
  message: string,
  fields: LogFields,
  trace?: string,
): string {
  const kept = Object.fromEntries(
    ALLOWED_FIELDS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]),
  );
  return JSON.stringify({
    severity,
    message,
    function: 'hello',
    ...kept,
    ...(trace ? { [TRACE_FIELD]: trace } : {}),
  });
}
