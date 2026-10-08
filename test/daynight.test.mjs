import test from 'node:test';
import assert from 'node:assert/strict';
import { skyAt, hoursAt, formatTime, DAY_LENGTH_SEC } from '../public/src/daynight.js';

test('昼は明るく夜は暗い。境目は連続', () => {
  assert.equal(skyAt(12).light, 1);
  assert.ok(skyAt(0).light < 0.3 && skyAt(0).night);
  assert.ok(!skyAt(12).night);
  for (let h = 0; h < 24; h += 0.01) {
    const a = skyAt(h).light, b = skyAt(h + 0.01).light;
    assert.ok(Math.abs(a - b) < 0.02, `h=${h.toFixed(2)} で不連続`);
    assert.ok(a >= 0.2 && a <= 1);
  }
  assert.deepEqual(skyAt(24), skyAt(0));
});

test('時刻の進み方と表示', () => {
  assert.equal(hoursAt(0), 10);
  assert.ok(Math.abs(hoursAt(DAY_LENGTH_SEC / 2) - 22) < 1e-9);
  assert.equal(formatTime(9.5), '09:30');
  assert.equal(formatTime(-1), '23:00');
});
