import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInteractiveSwipeTarget } from './useSwipeRow.js';

describe('isInteractiveSwipeTarget', () => {
  it('suppresses row taps that start on an interactive descendant', () => {
    const buttonChild = { closest: selector => selector.includes('button') ? {} : null };
    assert.equal(isInteractiveSwipeTarget(buttonChild), true);
  });

  it('allows row taps that start on ordinary row content', () => {
    const rowText = { closest: () => null };
    assert.equal(isInteractiveSwipeTarget(rowText), false);
  });

  it('handles non-element targets defensively', () => {
    assert.equal(isInteractiveSwipeTarget(null), false);
  });
});

describe('button rows', () => {
  it('allows a sender card button itself but still protects nested controls', () => {
    const button = {};
    assert.equal(isInteractiveSwipeTarget({ closest: () => button }, button), false);
    assert.equal(isInteractiveSwipeTarget({ closest: () => ({}) }, button), true);
  });
});
