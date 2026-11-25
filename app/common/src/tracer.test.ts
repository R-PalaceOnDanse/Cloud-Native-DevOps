import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Tracer,
  createTracer,
  InMemorySpanExporter,
  parseTraceParent,
  parseCloudTraceContext,
  generateTraceId,
  generateSpanId,
} from './tracer.js';
import { createStructuredLogger } from './logger.js';

describe('OpenTelemetry Distributed Tracing (Issue #88)', () => {
  it('generates valid 32-character hex traceId and 16-character hex spanId', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    assert.strictEqual(traceId.length, 32);
    assert.match(traceId, /^[0-9a-f]{32}$/);
    assert.strictEqual(spanId.length, 16);
    assert.match(spanId, /^[0-9a-f]{16}$/);
  });

  it('parses valid W3C traceparent headers', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceParent(header);

    assert.ok(parsed);
    assert.strictEqual(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.strictEqual(parsed.parentSpanId, '00f067aa0ba902b7');
    assert.strictEqual(parsed.sampled, true);
  });

  it('rejects invalid traceparent headers gracefully', () => {
    assert.strictEqual(parseTraceParent(undefined), null);
    assert.strictEqual(parseTraceParent(''), null);
    assert.strictEqual(parseTraceParent('invalid-format'), null);
    assert.strictEqual(parseTraceParent('01-abc-123-00'), null);
  });

  it('parses Google Cloud X-Cloud-Trace-Context headers', () => {
    const header = '4bf92f3577b34da6a3ce929d0e0e4736/123456789;o=1';
    const parsed = parseCloudTraceContext(header);

    assert.ok(parsed);
    assert.strictEqual(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.strictEqual(parsed.sampled, true);
    assert.ok(parsed.parentSpanId && parsed.parentSpanId.length === 16);
  });

  it('creates root span and exports it to Cloud Trace format', () => {
    const exporter = new InMemorySpanExporter();
    const tracer = createTracer('web-draw-proxy', exporter);

    const span = tracer.startSpan('web-draw-proxy:handleDraw', {
      attributes: {
        'http.method': 'POST',
        'http.route': '/draw',
        'correlation_id': 'corr-12345',
        'batch.size': 9,
      },
    });

    assert.strictEqual(span.name, 'web-draw-proxy:handleDraw');
    assert.strictEqual(span.attributes['service.name'], 'web-draw-proxy');
    assert.strictEqual(span.attributes['correlation_id'], 'corr-12345');
    assert.strictEqual(span.context.parentSpanId, undefined);

    const traceParent = span.toTraceParent();
    assert.match(traceParent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    tracer.endSpan(span);

    assert.strictEqual(exporter.spans.length, 1);
    const exported = exporter.spans[0]!;
    assert.ok(exported.endTime && exported.endTime >= exported.startTime);

    const gcpPayload = exported.toCloudTraceFormat('test-project-123');
    assert.strictEqual(gcpPayload.displayName.value, 'web-draw-proxy:handleDraw');
    assert.strictEqual(gcpPayload.spanId, exported.context.spanId);
    assert.ok(gcpPayload.name.includes('test-project-123'));
    assert.strictEqual(gcpPayload.attributes?.attributeMap['correlation_id']?.stringValue?.value, 'corr-12345');
  });

  it('propagates distributed trace from proxy to worker forming a single trace', () => {
    const exporter = new InMemorySpanExporter();
    const proxyTracer = new Tracer('web-draw-proxy', exporter);
    const workerTracer = new Tracer('draw-worker', exporter);

    // 1. Proxy receives request and starts root span
    const proxySpan = proxyTracer.startSpan('web-draw-proxy:handleDraw', {
      attributes: { 'correlation_id': 'draw-trace-flow-1' },
    });
    const traceParentOverPubSub = proxySpan.toTraceParent();
    proxyTracer.endSpan(proxySpan);

    // 2. Worker receives message over Pub/Sub carrying traceParent
    const workerSpan = workerTracer.startSpan('draw-worker:processDraw', {
      parentTraceParent: traceParentOverPubSub,
      attributes: { 'correlation_id': 'draw-trace-flow-1', 'pixels.count': 1 },
    });
    workerTracer.endSpan(workerSpan);

    assert.strictEqual(exporter.spans.length, 2);

    // Verify both spans belong to the EXACT SAME traceId
    const root = exporter.findSpan('web-draw-proxy:handleDraw')!;
    const child = exporter.findSpan('draw-worker:processDraw')!;

    assert.ok(root && child);
    assert.strictEqual(root.context.traceId, child.context.traceId);
    // Verify child span points to root span as parent
    assert.strictEqual(child.context.parentSpanId, root.context.spanId);
  });

  it('links traces to StructuredLogger output with Cloud Logging fields', () => {
    const tracer = createTracer('web-draw-proxy');
    const span = tracer.startSpan('test:logCorrelation');

    const logLines: string[] = [];
    const logger = createStructuredLogger('web-draw-proxy', {
      correlationId: 'corr-xyz',
      ...tracer.formatLoggingTraceFields(span, 'my-gcp-project'),
    });
    // Override outputStream
    const captureLogger = new (logger.constructor as any)({
      functionName: 'web-draw-proxy',
      defaultContext: {
        correlationId: 'corr-xyz',
        ...tracer.formatLoggingTraceFields(span, 'my-gcp-project'),
      },
      outputStream: (line: string) => logLines.push(line),
    });

    captureLogger.info('Pixel drawn successfully', { pixelCount: 5 });

    assert.strictEqual(logLines.length, 1);
    const parsed = JSON.parse(logLines[0]!);

    assert.strictEqual(parsed.correlationId, 'corr-xyz');
    assert.strictEqual(parsed.trace_id, span.context.traceId);
    assert.strictEqual(parsed.span_id, span.context.spanId);
    assert.strictEqual(parsed['logging.googleapis.com/trace'], `projects/my-gcp-project/traces/${span.context.traceId}`);
    assert.strictEqual(parsed['logging.googleapis.com/spanId'], span.context.spanId);
    assert.strictEqual(parsed['logging.googleapis.com/trace_sampled'], true);
  });
});
