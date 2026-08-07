export {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  RunNotificationSchemaError,
  guardRunNotification,
} from './run-notification'
export type {
  RunNotification,
  RunNotificationOutcome,
  RunNotificationStageStatus,
  RunNotificationStages,
  RunNotificationVerdictSummary,
} from './run-notification'
export { POST_PROCESSING_CHIP_STATUSES, isPostProcessingChipStatus } from './post-processing-status'
// 391 D-16/D-18: the per-run digest's read-time contract. A projection, never a record — see
// the module head for why it sits beside the frozen notification row instead of inside it.
export {
  RunDigestCandidateReportSchema,
  RunDigestChainOutcomesSchema,
  RunDigestProposalRowSchema,
  RunDigestQuarantineReportSchema,
  RunDigestSchema,
  RunsDigestInputSchema,
} from './run-digest'
export type {
  RunDigest,
  RunDigestCandidateReport,
  RunDigestChainOutcomes,
  RunDigestProposalRow,
  RunDigestQuarantineReport,
  RunsDigestInput,
} from './run-digest'
export type {
  PostProcessingChipStatus,
  PostProcessingChips,
  PostProcessingStatus,
} from './post-processing-status'
