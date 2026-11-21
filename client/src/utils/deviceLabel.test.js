import test from 'node:test';
import assert from 'node:assert';
import { parseDevice } from './deviceLabel.js';

const cases = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', 'Windows · Chrome', false],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36 Edg/122.0', 'Windows · Edge', false],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Mac · Safari', false],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari', true],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36', 'Android · Chrome', true],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Linux · Firefox', false],
];

for (const [ua, label, mobile] of cases) {
  test(`parses ${label}`, () => {
    const d = parseDevice(ua);
    assert.strictEqual(d.label, label);
    assert.strictEqual(d.mobile, mobile);
  });
}

test('empty or missing UA gives a safe fallback', () => {
  assert.strictEqual(parseDevice('').label, 'Unknown device');
  assert.strictEqual(parseDevice(undefined).label, 'Unknown device');
});
