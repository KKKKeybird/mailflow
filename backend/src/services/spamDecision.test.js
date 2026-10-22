import { describe, it, expect } from 'vitest';
import { createEmptyModel, updateIncremental, classifyMessage } from './spamModel.js';
import { selectSpamScore } from './spamDecision.js';

function trained(spamOnly = false) {
  let model = createEmptyModel();
  for (let i = 0; i < 108; i += 1) {
    const spam = spamOnly || i % 2 === 0;
    model = updateIncremental(model, spam ? ['promo', 'bargain', 'coupon'] : ['meeting', 'agenda', 'review'], {}, spam ? 'spam' : 'ham');
  }
  return model;
}
function decide(model, tokens, rules = 0, threshold = 0.85) {
  return selectSpamScore(model, tokens, rules, classifyMessage(model, tokens, {}).probability, threshold);
}
describe('model-first spam decisions', () => {
  it('recognizes learned spam with no rule hits at 108 records', () => {
    const result = decide(trained(), ['promo', 'bargain', 'coupon']);
    expect(result.method).toBe('ml');
    expect(result.score).toBeGreaterThan(0.95);
  });
  it('does not override confidently learned ham with a high rules score', () => {
    const result = decide(trained(), ['meeting', 'agenda', 'review'], 1);
    expect(result.method).toBe('ml');
    expect(result.score).toBeLessThan(0.15);
  });
  it('falls back for a single-class model even when its probability is 1', () => {
    const result = decide(trained(true), ['promo', 'bargain'], 0.1);
    expect(result).toMatchObject({ method: 'rules', score: 0.1, reason: 'single_class_training' });
  });
  it('cannot qualify unfamiliar text using the class prior alone', () => {
    expect(decide(trained(), ['unseen', 'unknown'], 0.4)).toMatchObject({ method: 'rules', score: 0.4 });
  });
  it('requires two distinct learned signals, not repetitions', () => {
    expect(decide(trained(), Array(100).fill('promo'))).toMatchObject({ method: 'rules', reason: 'uncertain_model' });
  });
  it('falls back when almost all text is unfamiliar', () => {
    const tokens = ['promo', 'bargain', ...Array.from({ length: 20 }, (_, i) => `unknown${i}`)];
    expect(decide(trained(), tokens)).toMatchObject({ method: 'rules', reason: 'unfamiliar_content' });
  });
  it('falls back for an uncertain model and respects saved spam thresholds', () => {
    const model = trained();
    expect(selectSpamScore(model, ['promo', 'bargain'], 0.4, 0.9, 0.95)).toMatchObject({ method: 'rules', score: 0.4 });
    expect(selectSpamScore(model, ['promo', 'bargain'], 0.4, 0.9, 0.85)).toMatchObject({ method: 'ml', score: 0.9 });
  });
  it('keeps cold start rules-only', () => {
    expect(decide(createEmptyModel(), ['promo', 'bargain'], 0.5)).toMatchObject({ method: 'rules', score: 0.5 });
  });
});
