#!/usr/bin/env node
/**
 * Burst Load Testing Tool (Issue #90, Decision #66 / ADR-0020).
 * Generates configurable concurrent bursts of draw requests through the API Gateway,
 * measures throughput, latency percentiles (p50, p95, p99), error rates,
 * and outputs metrics to prove serverless scaling on Cloud Monitoring.
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Parses command-line arguments into typed options.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const options = {
    targetUrl: process.env.GATEWAY_URL || 'http://localhost:8080/api/draw',
    concurrency: 10,
    totalRequests: 100,
    durationSeconds: undefined,
    burstSize: 9,
    delayMs: 20,
    token: undefined,
    dryRun: false,
    outputPath: 'tests/load/load-report.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' || arg === '--target-url') {
      options.targetUrl = argv[++i] || options.targetUrl;
    } else if (arg === '-c' || arg === '--concurrency') {
      options.concurrency = parseInt(argv[++i] || '10', 10);
    } else if (arg === '-n' || arg === '--requests') {
      options.totalRequests = parseInt(argv[++i] || '100', 10);
    } else if (arg === '-d' || arg === '--duration') {
      options.durationSeconds = parseInt(argv[++i] || '10', 10);
    } else if (arg === '-b' || arg === '--burst-size') {
      options.burstSize = Math.min(20, Math.max(1, parseInt(argv[++i] || '9', 10)));
    } else if (arg === '--delay') {
      options.delayMs = parseInt(argv[++i] || '20', 10);
    } else if (arg === '--token') {
      options.token = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '-o' || arg === '--output') {
      options.outputPath = argv[++i];
    }
  }

  return options;
}

/**
 * Generates a realistic batch of drawn pixels for a brush stroke.
 * @param {number} burstSize
 * @param {number} workerId
 * @param {number} [baseCoord=5000]
 */
export function generateDrawPayload(burstSize, workerId, baseCoord = 5000) {
  const pixels = [];
  const colors = ['#e11d48', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#000000'];
  const color = colors[workerId % colors.length] || '#e11d48';

  const offsetX = (workerId * 50) % 8000;
  const offsetY = (workerId * 30) % 8000;

  for (let i = 0; i < burstSize; i++) {
    pixels.push({
      x: baseCoord + offsetX + (i % 5),
      y: baseCoord + offsetY + Math.floor(i / 5),
      color,
    });
  }

  return pixels;
}

/**
 * Calculates statistical percentiles from a list of latencies.
 * @param {number[]} latencies
 */
export function calculatePercentiles(latencies) {
  if (latencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = sorted.reduce((sum, val) => sum + val, 0);

  const getPercentile = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round((sorted[idx] || 0) * 100) / 100;
  };

  return {
    min: Math.round((sorted[0] || 0) * 100) / 100,
    max: Math.round((sorted[sorted.length - 1] || 0) * 100) / 100,
    avg: Math.round((total / sorted.length) * 100) / 100,
    p50: getPercentile(50),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99),
  };
}

/**
 * Executes a simulated or live draw request.
 */
async function sendDrawRequest(options, workerId, fetchFn) {
  const correlationId = `trace-load-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const pixels = generateDrawPayload(options.burstSize, workerId);
  const start = performance.now();

  if (options.dryRun) {
    // Simulated network trip: 10ms - 35ms latency with deterministic success
    const simulatedDelay = 10 + Math.random() * 25;
    await new Promise((resolve) => setTimeout(resolve, simulatedDelay));
    const latencyMs = performance.now() - start;

    return {
      workerId,
      statusCode: 202,
      latencyMs: Math.round(latencyMs * 100) / 100,
      correlationId,
      pixelCount: pixels.length,
    };
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
    };

    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const response = await fetchFn(options.targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pixels }),
    });

    const latencyMs = performance.now() - start;
    return {
      workerId,
      statusCode: response.status,
      latencyMs: Math.round(latencyMs * 100) / 100,
      correlationId,
      pixelCount: pixels.length,
    };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      workerId,
      statusCode: 0,
      latencyMs: Math.round(latencyMs * 100) / 100,
      correlationId,
      pixelCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs the load testing suite orchestrating concurrent worker streams.
 */
export async function runLoadTest(options, fetchFn = globalThis.fetch) {
  const metrics = [];
  const statusCodes = {};
  let completedRequests = 0;
  const startTime = performance.now();
  const endTimeTarget = options.durationSeconds
    ? startTime + options.durationSeconds * 1000
    : Infinity;

  // Worker loop
  const runWorker = async (workerId) => {
    while (completedRequests < options.totalRequests && performance.now() < endTimeTarget) {
      completedRequests++;
      const metric = await sendDrawRequest(options, workerId, fetchFn);
      metrics.push(metric);

      statusCodes[metric.statusCode] = (statusCodes[metric.statusCode] || 0) + 1;

      if (options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  };

  // Launch workers up to concurrency level
  const workers = Array.from({ length: options.concurrency }, (_, i) => runWorker(i + 1));
  await Promise.all(workers);

  const durationMs = performance.now() - startTime;
  const latencies = metrics.map((m) => m.latencyMs);
  const latencyStats = calculatePercentiles(latencies);

  const successfulRequests = statusCodes[202] || 0;
  const rateLimitedRequests = statusCodes[429] || 0;
  const failedRequests = metrics.length - successfulRequests;
  const totalPixels = metrics.reduce((sum, m) => (m.statusCode === 202 ? sum + m.pixelCount : sum), 0);

  const summary = {
    options: {
      targetUrl: options.targetUrl,
      concurrency: options.concurrency,
      totalRequests: metrics.length,
      burstSize: options.burstSize,
      dryRun: options.dryRun,
    },
    totalRequests: metrics.length,
    successfulRequests,
    rateLimitedRequests,
    failedRequests,
    totalPixels,
    durationMs: Math.round(durationMs * 100) / 100,
    requestsPerSecond: Math.round((metrics.length / (durationMs / 1000)) * 100) / 100,
    pixelsPerSecond: Math.round((totalPixels / (durationMs / 1000)) * 100) / 100,
    statusCodes,
    latency: latencyStats,
    sampleCorrelationIds: metrics.slice(0, 5).map((m) => m.correlationId),
  };

  if (options.outputPath) {
    try {
      const outDir = path.dirname(options.outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(options.outputPath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch {
      // In tests or constrained environments, ignore write errors
    }
  }

  return summary;
}

/**
 * Formats the summary into a readable terminal report.
 */
export function formatReport(summary) {
  const mode = summary.options.dryRun ? 'DRY-RUN (Simulated Gateway)' : 'LIVE (Cloud Run Gateway)';
  return `
===============================================================
       SERVERLESS BURST LOAD TEST REPORT (Issue #90)
===============================================================
Mode:                 ${mode}
Target URL:           ${summary.options.targetUrl}
Concurrency:          ${summary.options.concurrency} concurrent streams
Burst Size:           ${summary.options.burstSize} pixels / stroke
Total Requests:       ${summary.totalRequests}
Successful (202):     ${summary.successfulRequests} (${Math.round((summary.successfulRequests / (summary.totalRequests || 1)) * 100)}%)
Rate Limited (429):   ${summary.rateLimitedRequests}
Failed / Errors:      ${summary.failedRequests}
Total Pixels Drawn:   ${summary.totalPixels} px
Total Duration:       ${(summary.durationMs / 1000).toFixed(2)} s
Throughput (Reqs):    ${summary.requestsPerSecond} req/s
Throughput (Pixels):  ${summary.pixelsPerSecond} pixels/s

--- Latency Percentiles (ms) ---
  Min:  ${summary.latency.min} ms
  p50:  ${summary.latency.p50} ms
  p90:  ${summary.latency.p90} ms
  p95:  ${summary.latency.p95} ms
  p99:  ${summary.latency.p99} ms
  Max:  ${summary.latency.max} ms
  Avg:  ${summary.latency.avg} ms

--- Sample Correlation IDs (for Cloud Logging tracing) ---
${summary.sampleCorrelationIds.map((id) => `  - ${id}`).join('\n')}
===============================================================
`;
}

// CLI entry point
const isMain = process.argv[1]?.endsWith('burst-load.mjs') || process.argv[1]?.endsWith('burst-load.js');
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Starting burst load test against ${options.targetUrl} (concurrency: ${options.concurrency}, requests: ${options.totalRequests})...`);
  runLoadTest(options)
    .then((summary) => {
      console.log(formatReport(summary));
      if (summary.failedRequests > 0 && !options.dryRun) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('Fatal load test error:', err);
      process.exitCode = 1;
    });
}
