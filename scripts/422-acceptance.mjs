#!/usr/bin/env node
// 422-24-T2 — the Phase 422 acceptance instrument.
//
// SKELETON. The surface below is what `packages/cli/src/__tests__/adversarial-acceptance.test.ts`
// asks for; the evidence gate and the demo modes are not implemented yet, and the contract cells
// that name them are RED on purpose.

/** The legs `--fixtures` must see execute and pass before it may exit zero. */
export const REQUIRED_FIXTURE_LEGS = ['release-exit-2', 'production-path']

/** Every mode that takes `--config <path>` and operates on the configured demo host. */
export const DEMO_MODES = ['--inspect-demo', '--stage-demo', '--check-staged', '--verify-admitted']

/** The subset that may not verify an admission, because none of them may cause one. */
export const READ_ONLY_MODES = ['--inspect-demo', '--stage-demo', '--check-staged']

/** A batch is named by its digest, never by a path a generated manifest could supply. */
export function isBatchDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** Unimplemented: the gate this task exists to build. */
export function validateFixtureEvidence(_evidence) {
  return []
}
