export type { Verdict, VerdictClass, VerdictEvidence } from './verdict'
export { VERDICT_CLASSES, isVerdictClass } from './verdict'
export type { VerdictGroundingQuote, VerdictSentenceParts } from './sentence-parts'
export { VerdictSentencePartsSchema } from './sentence-parts'
export {
  admitAnalysisArtifactForRun,
  ANALYSIS_FILE,
  ANALYSIS_MIGRATIONS,
  AnalysisVersionError,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  guardRunAnalysisArtifact,
} from './analysis-artifact'
export type { AnalysisArtifactAdmission, RunAnalysisArtifact } from './analysis-artifact'
export { resolveRunVerdicts, resolveVerdictMisdirection } from './resolved-verdicts'
export type { ResolvedMisdirection } from './resolved-verdicts'
export { failureFingerprint } from './failure-fingerprint'
export type { FailureFingerprintInput } from './failure-fingerprint'
// 393 D-13: the SIBLING coverage recipe, beside the frozen failure recipe and never extending
// it — it answers "what surface did this test exercise", not "how did it fail".
export {
  ACTION_ANCHOR_FINGERPRINT_VERSION,
  ASSERT_ACTION_TYPES,
  actionAnchorElement,
  actionAnchorSequence,
  testFingerprintElements,
} from './action-anchor-fingerprint'
export type {
  ActionAnchorElementInput,
  FingerprintEvidenceLike,
} from './action-anchor-fingerprint'
export { errorTextOf, failingStepOf } from './fingerprint-input'
export {
  QUOTE_SEARCHED_STEP_FIELDS,
  QUOTE_SEARCHED_TEST_OUTCOME_FIELDS,
  searchedQuoteTexts,
  searchedTestOutcomeTexts,
  validateAnalysisAgainstHandoff,
} from './validate-analysis'
export type {
  AnalysisValidationOptions,
  AnalysisValidationReject,
  AnalysisValidationResult,
} from './validate-analysis'
// 422 D-17/D-19/D-20: the circularity guard's evidence vocabulary. Membership derivation and
// the per-record cross-check fold are CODE, exported here so the one law the validator applies
// is the same law a producer composes its evidence with — never a second spelling.
export {
  aggregateMisdirectionEvidence,
  deriveMemoryOnPath,
  deriveMemoryOnPathSites,
  guardMisdirectionEvidence,
  MEMORY_ON_PATH_TRUSTS,
  MemoryOnPathEntrySchema,
  memoryOnPathTrustOf,
  MISDIRECTION_BACKINGS,
  MISDIRECTION_ROOT_POSTURES,
  misdirectionSourceDigest,
  MisdirectionEvidenceError,
  MisdirectionEvidenceSchema,
  MisdirectionRecordResultSchema,
} from './misdirection-evidence'
export type {
  MemoryOnPathEntry,
  MemoryOnPathSite,
  MemoryOnPathTrust,
  MisdirectionAggregate,
  MisdirectionAggregationInput,
  MisdirectionBacking,
  MisdirectionEvidence,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
  MisdirectionSamples,
} from './misdirection-evidence'
