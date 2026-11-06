// lib/schema/ids.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeId, isGlobalId } from './ids.mjs';

test('makeId returns a non-empty, space-free string', () => {
  const id = makeId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length >= 8);
  assert.ok(!/\s/.test(id));
});

test('makeId is unique across calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(makeId());
  assert.equal(seen.size, 1000);
});

test('isGlobalId rejects legacy timestamp ids (they contain spaces)', () => {
  assert.equal(isGlobalId('2026-05-19 Tue 21:04'), false);
  assert.equal(isGlobalId('2026-05-19 Tue 21:04 (2)'), false);
  assert.equal(isGlobalId(''), false);
  assert.equal(isGlobalId(null), false);
});

test('isGlobalId accepts a fresh makeId', () => {
  assert.equal(isGlobalId(makeId()), true);
});
