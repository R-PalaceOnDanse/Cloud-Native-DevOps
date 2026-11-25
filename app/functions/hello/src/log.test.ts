import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type LogFields, logLine, traceName } from './log';

test('a line carries the severity, the message and the correlation id', () => {
  const line = JSON.parse(logLine('INFO', 'hello served', { correlation_id: 'abc', path: '/' }));
  assert.deepEqual(line, {
    severity: 'INFO',
    message: 'hello served',
    function: 'hello',
    correlation_id: 'abc',
    path: '/',
  });
});

test('the trace field links the line to its Cloud Trace trace', () => {
  const trace = traceName('105445aa7843bc8bf206b12000100000/1;o=1', 'my-project');
  const line = JSON.parse(logLine('INFO', 'hello served', { correlation_id: 'abc' }, trace));
  assert.equal(
    line['logging.googleapis.com/trace'],
    'projects/my-project/traces/105445aa7843bc8bf206b12000100000',
  );
});

test('there is no trace without the header or without the project', () => {
  assert.equal(traceName(undefined, 'my-project'), undefined);
  assert.equal(traceName('abc/1', ''), undefined);
});

test('a token or a payload passed by mistake never reaches the line', () => {
  const leaky = {
    correlation_id: 'abc',
    authorization: 'Bearer secret-token',
    body: { pixel: [1, 2, 3] },
    secret_value: 'hunter2',
  } as LogFields;
  const line = logLine('ERROR', 'secret could not be read', leaky);
  assert.deepEqual(Object.keys(JSON.parse(line)).sort(), [
    'correlation_id',
    'function',
    'message',
    'severity',
  ]);
  assert.ok(!/secret-token|hunter2|pixel/.test(line));
});
