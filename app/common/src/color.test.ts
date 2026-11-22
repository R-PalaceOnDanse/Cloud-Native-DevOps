import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeColor, isValidColor, STANDARD_PALETTE } from './color.js';

test('normalizeColor parses named colors into hex', () => {
  assert.equal(normalizeColor('red'), '#ff0000');
  assert.equal(normalizeColor('RED'), '#ff0000');
  assert.equal(normalizeColor('  black  '), '#000000');
  assert.equal(normalizeColor('lime'), '#00ff00');
  assert.equal(normalizeColor('white'), '#ffffff');
});

test('normalizeColor parses 6-digit hex format with or without hash', () => {
  assert.equal(normalizeColor('#1a2b3c'), '#1a2b3c');
  assert.equal(normalizeColor('#AABBCC'), '#aabbcc');
  assert.equal(normalizeColor('112233'), '#112233');
});

test('normalizeColor rejects invalid formats', () => {
  assert.throws(() => normalizeColor('not-a-color'), /Invalid color/);
  assert.throws(() => normalizeColor('#123'), /Invalid color/); // short hex not accepted
  assert.throws(() => normalizeColor('#1234567'), /Invalid color/);
});

test('isValidColor accurately reports validity', () => {
  assert.equal(isValidColor('blue'), true);
  assert.equal(isValidColor('#00ffaa'), true);
  assert.equal(isValidColor('xyz'), false);
});
