import type {
  Approval,
  ApprovalId,
  Job,
  JobId,
  JobStatus,
  Patch,
  PatchId,
} from '@vostride/agent-qa-schema'

export interface PersistencePort {
  saveJob(job: Job): Promise<void>
  getJob(id: JobId): Promise<Job | undefined>
  listJobs(status?: JobStatus): Promise<Job[]>

  saveCheckpoint(jobId: JobId, checkpoint: unknown): Promise<void>
  loadCheckpoint(jobId: JobId): Promise<unknown | undefined>

  appendConversation(jobId: JobId, event: unknown): Promise<void>
  loadConversation(jobId: JobId): Promise<unknown[]>

  saveApproval(approval: Approval): Promise<void>
  getApproval(id: ApprovalId): Promise<Approval | undefined>

  savePatch(patch: Patch): Promise<void>
  getPatch(id: PatchId): Promise<Patch | undefined>
}
