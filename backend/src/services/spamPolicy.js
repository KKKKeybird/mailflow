// Shared by the settings API and ingestion: saved score thresholds must be
// the same thresholds that classify and move newly arriving messages.
export const DEFAULT_SPAM_THRESHOLDS = {
  minRecords: 50,
  softRecords: 500,
  hardRecords: 500,
  spamThreshold: 0.85,
  autoMoveThreshold: 0.95,
};

export function resolveSpamScoreThresholds(stored) {
  const valid = (value, min) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 0.99;
  return {
    spamThreshold: valid(stored?.spamThreshold, 0.5) ? stored.spamThreshold : DEFAULT_SPAM_THRESHOLDS.spamThreshold,
    autoMoveThreshold: valid(stored?.autoMoveThreshold, 0.7) ? stored.autoMoveThreshold : DEFAULT_SPAM_THRESHOLDS.autoMoveThreshold,
  };
}
