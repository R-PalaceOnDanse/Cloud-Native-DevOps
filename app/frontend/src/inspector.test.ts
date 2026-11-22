import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPixelInspection } from './inspector.js';

test('formatPixelInspection returns empty pixel description for unpainted coordinates', () => {
  const info = formatPixelInspection(undefined, 100, 200);
  assert.equal(info.coordsText, '(100, 200)');
  assert.equal(info.authorText, 'Vide (pixel vierge)');
  assert.equal(info.timeText, 'Jamais modifié');
  assert.equal(info.isEmpty, true);
  assert.equal(info.isOutOfBounds, false);
});

test('formatPixelInspection returns author and formatted timestamp for painted pixel', () => {
  const timestamp = Date.parse('2026-11-22T21:00:00Z');
  const info = formatPixelInspection(
    {
      author: 'DiscordUser#1234',
      color: '#00ff00',
      timestamp,
    },
    42,
    84
  );

  assert.equal(info.coordsText, '(42, 84)');
  assert.equal(info.authorText, 'DiscordUser#1234');
  assert.equal(info.colorText, '#00ff00');
  assert.equal(info.hexColor, '#00ff00');
  assert.equal(info.isEmpty, false);
  assert.equal(info.isOutOfBounds, false);
});

test('formatPixelInspection handles out-of-bounds coordinates', () => {
  const info = formatPixelInspection(undefined, -1, 500);
  assert.equal(info.coordsText, 'Hors champ');
  assert.equal(info.authorText, '—');
  assert.equal(info.isOutOfBounds, true);
  assert.equal(info.isEmpty, false);

  const infoOver = formatPixelInspection(undefined, 10000, 10000);
  assert.equal(infoOver.coordsText, 'Hors champ');
  assert.equal(infoOver.isOutOfBounds, true);
});
