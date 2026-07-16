export { BundleOutcomeEventSchema, dedupeEvents, eventDedupKey } from './outcome-event'
export type { BundleOutcomeEvent, OriginClass } from './outcome-event'
export {
  EVIDENCE_INCOMPLETE_ALPHA_DISCOUNT,
  ORIGIN_PRIORS,
  SERVING_ATTRIBUTION_WEIGHT,
  foldBundleTrust,
} from './trust-fold'
export type { BundleStatus, DerivedTrustState } from './trust-fold'
export {
  BIMODAL_GAP_THRESHOLD,
  BIMODAL_MIN_MODE_N,
  CI_SEPARATION_Z,
  CUSUM_DECISION_H,
  CUSUM_SLACK_K,
  DRIFT_RELATIVE_THRESHOLD,
  DRIFT_SIGMA_K,
  KIND_CV_FLOOR,
  KIND_DEFAULT_CV,
  MEASUREMENT_MIN_N,
  MULTIMODAL_TRAILING_BUILDS,
  SHRINKAGE_PSEUDO_N,
  bimodalSplit,
  cusumStep,
  decideMeasurementDrift,
  foldMeasurements,
  measurementBaselineSchema,
  measurementObservationSchema,
  shrunkSigma,
} from './measurement-fold'
export type {
  BimodalSplit,
  CusumState,
  CusumStepResult,
  DecideMeasurementDriftInput,
  DerivedMeasurementState,
  MeasurementBand,
  MeasurementBaseline,
  MeasurementDriftDecision,
  MeasurementDriftWindowBuilds,
  MeasurementFoldState,
  MeasurementObservation,
} from './measurement-fold'
export {
  ArtifactsIndexSchema,
  BUNDLE_SCHEMA_VERSION,
  BundleManifestSchema,
  BundleProvenanceSchema,
  BundleRelationsSchema,
  computeMutableStateHash,
  guardArtifactsIndex,
  guardBundleManifest,
  guardBundleProvenance,
  guardBundleRelations,
} from './bundle-files'
export type {
  ArtifactsIndex,
  BundleManifest,
  BundleProvenance,
  BundleRelation,
  BundleRelations,
  MutableStateHashInput,
} from './bundle-files'
export { verifyManifestIdentity } from './manifest-identity'
export { emitRecordMarkdown, parseRecordMarkdown } from './record-frontmatter'
export type { RecordFrontmatter } from './record-frontmatter'
export { renderEmbeddingInput, screenStateSnapshotRelPath } from './embedding-input'
export { deriveEvidenceToken } from './evidence-token'
