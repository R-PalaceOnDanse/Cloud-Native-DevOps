/**
 * Unit & Integration Tests for Burst Load Testing Tool (Issue #90).
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseArgs,
  generateDrawPayload,
  calculatePercentiles,
  runLoadTest,
  formatReport,
} from './burst-load.mjs';

describe('Burst Load Testing Engine (Issue #90)', () => {
  test('parseArgs applies sane defaults when no arguments given', () => {
    const opts = parseArgs([]);
    assert.equal(opts.concurrency, 10);
    assert.equal(opts.totalRequests, 100);
    assert.equal(opts.burstSize, 9);
    assert.equal(opts.dryRun, false);
    assert.ok(opts.targetUrl.includes('/draw'));
  });

  test('parseArgs correctly parses custom CLI flags', () => {
    const argv = [
      '--url', 'https://gateway.example.com/api/draw',
      '-c', '25',
      '-n', '500',
      '-b', '16',
      '--delay', '10',
      '--token', 'test-bearer-token',
      '--dry-run',
      '-o', 'custom-report.json',
    ];

    const opts = parseArgs(argv);
    assert.equal(opts.targetUrl, 'https://gateway.example.com/api/draw');
    assert.equal(opts.concurrency, 25);
    assert.equal(opts.totalRequests, 500);
    assert.equal(opts.burstSize, 16);
    assert.equal(opts.delayMs, 10);
    assert.equal(opts.token, 'test-bearer-token');
    assert.equal(opts.dryRun, true);
    assert.equal(opts.outputPath, 'custom-report.json');
  });

  test('parseArgs clamps burstSize between 1 and 20 (max token capacity)', () => {
    const clampedMax = parseArgs(['-b', '50']);
    assert.equal(clampedMax.burstSize, 20);

    const clampedMin = parseArgs(['-b', '0']);
    assert.equal(clampedMin.burstSize, 1);
  });

  test('generateDrawPayload generates valid coordinates and hex colors', () => {
    const payload = generateDrawPayload(9, 2);
    assert.equal(payload.length, 9);

    for (const px of payload) {
      assert.ok(px.x >= 0 && px.x < 10000, `x out of range: ${px.x}`);
      assert.ok(px.y >= 0 && px.y < 10000, `y out of range: ${px.y}`);
      assert.match(px.color, /^#[0-9a-f]{6}$/i);
    }
  });

  test('calculatePercentiles correctly calculates min, max, avg, and percentiles', () => {
    // 100 samples from 1 to 100
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = calculatePercentiles(latencies);

    assert.equal(stats.min, 1);
    assert.equal(stats.max, 100);
    assert.equal(stats.avg, 50.5);
    assert.equal(stats.p50, 51);
    assert.equal(stats.p90, 91);
    assert.equal(stats.p95, 96);
    assert.equal(stats.p99, 100);
  });

  test('calculatePercentiles handles empty input safely', () => {
    const stats = calculatePercentiles([]);
    assert.equal(stats.min, 0);
    assert.equal(stats.p50, 0);
    assert.equal(stats.max, 0);
  });

  test('runLoadTest executes smoothly in dry-run mode', async () => {
    const options = {
      targetUrl: 'http://localhost:8080/api/draw',
      concurrency: 5,
      totalRequests: 20,
      burstSize: 4,
      delayMs: 2,
      dryRun: true,
      outputPath: undefined,
    };

    const summary = await runLoadTest(options);

    assert.equal(summary.totalRequests, 20);
    assert.equal(summary.successfulRequests, 20);
    assert.equal(summary.failedRequests, 0);
    assert.equal(summary.totalPixels, 80); // 20 requests * 4 pixels
    assert.ok(summary.durationMs > 0);
    assert.ok(summary.requestsPerSecond > 0);
    assert.ok(summary.latency.p95 > 0);
    assert.equal(summary.statusCodes[202], 20);
    assert.ok(summary.sampleCorrelationIds.length > 0);
    assert.match(summary.sampleCorrelationIds[0], /^trace-load-/);
  });

  test('runLoadTest tracks live responses, 429 rate limits, and network errors', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      // Return 202 for first 3, 429 for 4th, network error for 5th
      if (callCount <= 3) {
        return new Response(JSON.stringify({ status: 'accepted' }), { status: 202 });
      } else if (callCount === 4) {
        return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
      } else {
        throw new Error('Connection reset by peer');
      }
    };

    const options = {
      targetUrl: 'https://api-gateway.mock/draw',
      concurrency: 2,
      totalRequests: 5,
      burstSize: 3,
      delayMs: 1,
      dryRun: false,
      outputPath: undefined,
    };

    const summary = await runLoadTest(options, mockFetch);

    assert.equal(summary.totalRequests, 5);
    assert.equal(summary.successfulRequests, 3);
    assert.equal(summary.rateLimitedRequests, 1);
    assert.equal(summary.failedRequests, 2);
    assert.equal(summary.totalPixels, 9); // 3 * 3
    assert.equal(summary.statusCodes[202], 3);
    assert.equal(summary.statusCodes[429], 1);
    assert.equal(summary.statusCodes[0], 1); // Network failure
  });

  test('formatReport produces clear human-readable output', () => {
    const summary = {
      options: {
        targetUrl: 'https://api-gateway.mock/draw',
        concurrency: 10,
        totalRequests: 50,
        burstSize: 9,
        dryRun: false,
      },
      totalRequests: 50,
      successfulRequests: 48,
      rateLimitedRequests: 2,
      failedRequests: 2,
      totalPixels: 432,
      durationMs: 1250,
      requestsPerSecond: 40,
      pixelsPerSecond: 345.6,
      statusCodes: { 202: 48, 429: 2 },
      latency: { min: 12, max: 85, avg: 31, p50: 28, p90: 55, p95: 68, p99: 82 },
      sampleCorrelationIds: ['trace-load-1', 'trace-load-2'],
    };

    const report = formatReport(summary);
    assert.match(report, /SERVERLESS BURST LOAD TEST REPORT/);
    assert.match(report, /48 \(96%\)/);
    assert.match(report, /p95:\s+68 ms/);
    assert.match(report, /trace-load-1/);
  });
});
