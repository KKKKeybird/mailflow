// A model probability is not calibrated confidence. Require learned evidence
// from both classes before allowing it to replace the rules score. In particular,
// one-class training produces an infinite prior log-odds for every message.
export function selectSpamScore(model, tokens, rulesScore, probability, spamThreshold) {
  const evidence = { coverage: 0, spamTokens: 0, hamTokens: 0 };
  const fallback = reason => ({ score: rulesScore, method: 'rules', reason, evidence });
  if (!model || model.trainingRecords < 50 || !Number.isFinite(probability)) return fallback('insufficient_training');
  if (!(model.totalSpam > 0 && model.totalHam > 0)) return fallback('single_class_training');

  // Count distinct text tokens, not repetitions or fixed authentication flags.
  // Repeating a familiar word must not qualify an otherwise unfamiliar message.
  const unique = [...new Set(tokens)];
  const vocabulary = model.vocabulary;
  const size = Object.keys(vocabulary).length;
  let known = 0;
  for (const token of unique) {
    const entry = vocabulary[token];
    if (!entry) continue;
    known += 1;
    if (entry.spam + entry.ham < 3) continue;
    const contribution = Math.log((entry.spam + 1) / (model.totalSpam + size))
      - Math.log((entry.ham + 1) / (model.totalHam + size));
    if (contribution >= 0.5) evidence.spamTokens += 1;
    if (contribution <= -0.5) evidence.hamTokens += 1;
  }
  evidence.coverage = unique.length ? known / unique.length : 0;
  if (evidence.coverage < 0.2) return fallback('unfamiliar_content');
  if (probability >= spamThreshold && evidence.spamTokens >= 2) {
    return { score: probability, method: 'ml', reason: 'confident_spam', evidence };
  }
  // Strong ham is a decision too; do not overturn it with noisy marketing rules.
  if (probability <= 1 - spamThreshold && evidence.hamTokens >= 2) {
    return { score: probability, method: 'ml', reason: 'confident_ham', evidence };
  }
  return fallback('uncertain_model');
}
