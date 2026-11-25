/**
 * OpenTelemetry-Compatible Distributed Tracing Engine (Issue #88).
 * 
 * Implements:
 * 1. W3C TraceContext propagation (RFC 00-traceid-spanid-flags).
 * 2. GCP X-Cloud-Trace-Context extraction and formatting.
 * 3. End-to-end trace linking across HTTP proxies and Pub/Sub workers via correlation ID.
 * 4. Google Cloud Trace v2 API formatting and Cloud Logging bidirectional linking.
 */

import { randomBytes } from 'node:crypto';

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly sampled: boolean;
}

export interface SpanOptions {
  name: string;
  parentTraceParent?: string | undefined;
  parentSpan?: Span | undefined;
  attributes?: Record<string, string | number | boolean | undefined> | undefined;
  startTime?: number | undefined;
}

export interface CloudTraceSpanPayload {
  name: string;
  spanId: string;
  parentSpanId?: string | undefined;
  displayName: { value: string };
  startTime: string;
  endTime: string;
  attributes?: {
    attributeMap: Record<string, { stringValue?: { value: string }; int64Value?: string; boolValue?: boolean }>;
  } | undefined;
  status?: { code: number; message?: string } | undefined;
}

export interface SpanExporter {
  export(span: Span): Promise<void> | void;
}

/**
 * In-Memory Span Exporter for unit tests, offline development, and local inspection.
 */
export class InMemorySpanExporter implements SpanExporter {
  public readonly spans: Span[] = [];

  public export(span: Span): void {
    this.spans.push(span);
  }

  public clear(): void {
    this.spans.length = 0;
  }

  public getSpans(): Span[] {
    return [...this.spans];
  }

  public findSpan(name: string): Span | undefined {
    return this.spans.find((s) => s.name === name);
  }

  public getTraceSpans(traceId: string): Span[] {
    return this.spans.filter((s) => s.context.traceId === traceId);
  }
}

/**
 * Cloud Trace Exporter for Google Cloud Trace REST API (Cloud Trace v2).
 */
export class CloudTraceExporter implements SpanExporter {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  public async export(span: Span): Promise<void> {
    const payload = span.toCloudTraceFormat(this.projectId);
    // In live environments, can batch or POST to Cloud Trace API:
    // https://cloudtrace.googleapis.com/v2/projects/${this.projectId}/traces:batchWrite
    if (process.env.DEBUG_TRACES === 'true') {
      console.log(`[CloudTraceExporter] Exporting span ${span.name} (${span.context.traceId})`, JSON.stringify(payload));
    }
  }
}

/**
 * Represents an individual timed unit of execution in a distributed trace.
 */
export class Span {
  public readonly name: string;
  public readonly context: SpanContext;
  public readonly startTime: number;
  public endTime?: number | undefined;
  public readonly attributes: Record<string, string | number | boolean> = {};
  public status: 'OK' | 'ERROR' = 'OK';
  public statusMessage?: string | undefined;

  constructor(name: string, context: SpanContext, startTime?: number, initialAttributes?: Record<string, string | number | boolean | undefined>) {
    this.name = name;
    this.context = context;
    this.startTime = startTime ?? Date.now();

    if (initialAttributes) {
      this.setAttributes(initialAttributes);
    }
  }

  public setAttribute(key: string, value: string | number | boolean | undefined): this {
    if (value !== undefined) {
      this.attributes[key] = value;
    }
    return this;
  }

  public setAttributes(attrs: Record<string, string | number | boolean | undefined>): this {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        this.attributes[key] = value;
      }
    }
    return this;
  }

  public setStatus(status: 'OK' | 'ERROR', message?: string): this {
    this.status = status;
    this.statusMessage = message;
    return this;
  }

  public end(endTime?: number): void {
    if (this.endTime === undefined) {
      this.endTime = endTime ?? Date.now();
    }
  }

  public get durationMs(): number {
    return (this.endTime ?? Date.now()) - this.startTime;
  }

  /**
   * Generates standard W3C traceparent header value: 00-${traceId}-${spanId}-${flags}.
   */
  public toTraceParent(): string {
    const flags = this.context.sampled ? '01' : '00';
    return `00-${this.context.traceId}-${this.context.spanId}-${flags}`;
  }

  /**
   * Converts this span into Google Cloud Trace v2 REST API format.
   */
  public toCloudTraceFormat(projectId: string): CloudTraceSpanPayload {
    const startIso = new Date(this.startTime).toISOString();
    const endIso = new Date(this.endTime ?? this.startTime).toISOString();

    const attributeMap: Record<string, { stringValue?: { value: string }; int64Value?: string; boolValue?: boolean }> = {};
    for (const [key, val] of Object.entries(this.attributes)) {
      if (typeof val === 'string') {
        attributeMap[key] = { stringValue: { value: val } };
      } else if (typeof val === 'number') {
        attributeMap[key] = { int64Value: String(Math.floor(val)) };
      } else if (typeof val === 'boolean') {
        attributeMap[key] = { boolValue: val };
      }
    }

    const payload: CloudTraceSpanPayload = {
      name: `projects/${projectId}/traces/${this.context.traceId}/spans/${this.context.spanId}`,
      spanId: this.context.spanId,
      parentSpanId: this.context.parentSpanId,
      displayName: { value: this.name },
      startTime: startIso,
      endTime: endIso,
      attributes: { attributeMap },
    };

    if (this.status === 'ERROR') {
      payload.status = { code: 2, message: this.statusMessage || 'Error' }; // 2 = UNKNOWN error in gRPC / Cloud Trace
    } else {
      payload.status = { code: 0 }; // 0 = OK
    }

    return payload;
  }
}

/**
 * Parses a standard W3C traceparent header.
 * Syntax: 00-${traceId (32 hex)}-${spanId (16 hex)}-${flags (2 hex)}
 */
export function parseTraceParent(header?: string | null): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  if (!header || typeof header !== 'string') return null;
  const match = header.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!match) return null;

  const traceId = match[1]!.toLowerCase();
  const parentSpanId = match[2]!.toLowerCase();
  const flags = parseInt(match[3]!, 16);
  const sampled = (flags & 0x01) === 1;

  return { traceId, parentSpanId, sampled };
}

/**
 * Parses Google Cloud's X-Cloud-Trace-Context header.
 * Syntax: TRACE_ID/SPAN_ID;o=TRACE_TRUE
 */
export function parseCloudTraceContext(header?: string | null): { traceId: string; parentSpanId?: string | undefined; sampled: boolean } | null {
  if (!header || typeof header !== 'string') return null;
  const match = header.trim().match(/^([0-9a-f]{32})(?:\/([0-9]+))?(?:;o=([01]))?$/i);
  if (!match) return null;

  const traceId = match[1]!.toLowerCase();
  let parentSpanId: string | undefined = undefined;

  if (match[2]) {
    // GCP format can be decimal span ID; convert to 16-char hex
    try {
      const dec = BigInt(match[2]);
      parentSpanId = dec.toString(16).padStart(16, '0');
    } catch {
      parentSpanId = match[2].padStart(16, '0').slice(0, 16);
    }
  }

  const sampled = match[3] === '1';
  return { traceId, parentSpanId, sampled };
}

/**
 * Generates a valid random 16-byte (32 hex characters) trace ID.
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generates a valid random 8-byte (16 hex characters) span ID.
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Main OpenTelemetry Tracer.
 */
export class Tracer {
  public readonly serviceName: string;
  public readonly exporter: SpanExporter;

  constructor(serviceName: string, exporter?: SpanExporter) {
    this.serviceName = serviceName;
    this.exporter = exporter || new InMemorySpanExporter();
  }

  /**
   * Starts a new span. If a parent traceparent or parent span is provided,
   * continues the trace context and establishes a parent-child relationship.
   */
  public startSpan(name: string, options: Partial<SpanOptions> = {}): Span {
    let traceId: string;
    let parentSpanId: string | undefined = undefined;
    let sampled = true;

    if (options.parentSpan) {
      traceId = options.parentSpan.context.traceId;
      parentSpanId = options.parentSpan.context.spanId;
      sampled = options.parentSpan.context.sampled;
    } else if (options.parentTraceParent) {
      const parsedW3C = parseTraceParent(options.parentTraceParent);
      if (parsedW3C) {
        traceId = parsedW3C.traceId;
        parentSpanId = parsedW3C.parentSpanId;
        sampled = parsedW3C.sampled;
      } else {
        const parsedGcp = parseCloudTraceContext(options.parentTraceParent);
        if (parsedGcp) {
          traceId = parsedGcp.traceId;
          parentSpanId = parsedGcp.parentSpanId;
          sampled = parsedGcp.sampled;
        } else {
          traceId = generateTraceId();
        }
      }
    } else {
      traceId = generateTraceId();
    }

    const spanId = generateSpanId();
    const spanContext: SpanContext = { traceId, spanId, parentSpanId, sampled };

    const initialAttributes = {
      'service.name': this.serviceName,
      ...options.attributes,
    };

    return new Span(name, spanContext, options.startTime, initialAttributes);
  }

  /**
   * Ends a span and exports it to the configured backend.
   */
  public endSpan(span: Span): void {
    span.end();
    void this.exporter.export(span);
  }

  /**
   * Formats Google Cloud Logging structured trace attributes for log correlation.
   * Enables Google Cloud Log Explorer to link log lines to Cloud Trace spans.
   */
  public formatLoggingTraceFields(span: Span, projectId?: string): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      trace_id: span.context.traceId,
      span_id: span.context.spanId,
    };

    if (projectId) {
      fields['logging.googleapis.com/trace'] = `projects/${projectId}/traces/${span.context.traceId}`;
      fields['logging.googleapis.com/spanId'] = span.context.spanId;
      fields['logging.googleapis.com/trace_sampled'] = span.context.sampled;
    }

    return fields;
  }
}

export function createTracer(serviceName: string, exporter?: SpanExporter): Tracer {
  return new Tracer(serviceName, exporter);
}
