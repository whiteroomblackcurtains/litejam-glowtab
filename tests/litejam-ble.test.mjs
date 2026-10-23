import assert from 'node:assert/strict';
import test from 'node:test';

import { prioritizeGroups } from '../js/litejam-ble.js';

test('syntax groups replace earlier colors at the same LED position', () => {
  const groups = prioritizeGroups([
    { leds: [{ fret: 8, strings: [3] }], color: { r: 0, g: 229, b: 255 } },
    { leds: [{ fret: 20, strings: [3] }], color: { r: 255, g: 0, b: 0 } },
    { leds: [{ fret: 8, strings: [3] }], color: { r: 255, g: 0, b: 0 } },
  ]);

  assert.deepEqual(groups, [
    { leds: [{ fret: 20, strings: [3] }], color: { r: 255, g: 0, b: 0 } },
    { leds: [{ fret: 8, strings: [3] }], color: { r: 255, g: 0, b: 0 } },
  ]);
});