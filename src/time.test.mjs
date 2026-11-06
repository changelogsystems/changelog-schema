// lib/schema/time.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimestamp } from './time.mjs';

test('formatTimestamp renders the shape YYYY-MM-DD ddd HH:mm', () => {
  const d = new Date(2026, 4, 19, 21, 4); // 2026-05-19 21:04 local (Tue)
  assert.equal(formatTimestamp(d), '2026-05-19 Tue 21:04');
});

test('formatTimestamp zero-pads month, day, hour, minute', () => {
  const d = new Date(2026, 0, 2, 3, 5); // 2026-01-02 03:05 (Fri)
  assert.equal(formatTimestamp(d), '2026-01-02 Fri 03:05');
});
