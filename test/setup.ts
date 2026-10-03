// Silences the logger during tests. Goes in `setupFiles` (before importing the
// test modules) because the logger is configured on import.
process.env.SAMBLE_LOG_LEVEL = 'off';
