import { rebuildIndex, type RebuildIndexOptions } from '../../index-rebuild.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'

/** Index-serving fixtures need the same completed, lease-authorized epoch as a real host. */
export async function rebuildAuthorizedIndex(options: RebuildIndexOptions) {
  const lease = acquireWriterLease(options.knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('fixture could not acquire index writer lease')
  const writerAuthority = {
    knowledgeRoot: options.knowledgeRoot,
    leaseId: lease.leaseId,
    epoch: lease.epoch,
  }
  try {
    return await rebuildIndex({ ...options, writerAuthority })
  } finally {
    releaseLease(writerAuthority)
  }
}
