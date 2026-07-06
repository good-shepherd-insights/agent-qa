// Barrel for the pure, provider-neutral compound helpers all four EXEC behaviors ride (D-02).
// Re-exported from the runner barrel (packages/runner/src/index.ts) so adapter packages import
// the helpers — the 352 buildScreenState precedent. Nothing under compound/ imports drivers or
// Node builtins; keep validate:arch green.

export * from './metadata.js'
