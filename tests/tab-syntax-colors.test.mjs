import assert from 'node:assert/strict';
import test from 'node:test';

import { tabSyntaxKey } from '../js/tab-syntax-colors.js';

test('tab syntax colors classify alphaTab harmonic enum values', () => {
  assert.equal(tabSyntaxKey({ harmonicType: 1 }), 'naturalHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 2 }), 'naturalHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 3 }), 'pinchHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 4 }), 'tapHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 5 }), 'naturalHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 6 }), 'naturalHarmonic');
  assert.equal(tabSyntaxKey({ harmonicType: 'Pinch' }), 'pinchHarmonic');
});

test('tab syntax colors classify alphaTab slide-in and slide-out enum values', () => {
  assert.equal(tabSyntaxKey({ slideOutType: 2 }), 'legatoSlide');
  assert.equal(tabSyntaxKey({ slideOutType: 3 }), 'slideUp');
  assert.equal(tabSyntaxKey({ slideOutType: 4 }), 'slideDown');
  assert.equal(tabSyntaxKey({ slideInType: 1 }), 'slideUp');
  assert.equal(tabSyntaxKey({ slideInType: 2 }), 'slideDown');
  assert.equal(tabSyntaxKey({ slideOutType: 'Legato' }), 'legatoSlide');
  assert.equal(tabSyntaxKey({ slideOutType: 'OutDown' }), 'slideDown');
});

test('harmonics take precedence over hammer-pull destination flags', () => {
  assert.equal(tabSyntaxKey({ harmonicType: 3, isHammerPullDestination: true }), 'pinchHarmonic');
});

test('slide destinations determine slide color when enum values are unavailable', () => {
  assert.equal(tabSyntaxKey({ fret: 7, slideTarget: { fret: 10 } }), 'slideUp');
  assert.equal(tabSyntaxKey({ fret: 10, slideTarget: { fret: 7 } }), 'slideDown');
});