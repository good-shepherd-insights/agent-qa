// 2026-09-30, 432-11 D-05: a config proposal as the pre-432 pipeline filed it, written to disk.
//
// The six config operations now write in the call and file nothing. Proposal records written
// before that still sit in `.agent-qa/proposals/`. Since 432-16 no host binds the config apply port
// that applied them, so `proposals.accept` / `config.proposal.apply` refuse such a record by name;
// the suites that measure that refusal start from a record this helper writes the way the old
// pipeline did. 432-17 deletes the verbs, and this helper with them.

import { mintProposalId, writePendingProposalRecord } from '@vostride/agent-qa-knowledge-local'
import type { ConfigStructuredValue } from '@vostride/agent-qa-agent'
import {
  CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  base64Encode,
  renderConfigDiff,
  utf8Decode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigDiffFileInput,
  ConfigProposalApplyableV1,
  CrossBoundaryReason,
  ProposalRecord,
} from '@vostride/agent-qa-schema'

import { createConfigFilesPort } from '../local-agent-host.js'

export interface Pre432ConfigProposal {
  readonly proposalId: string
  readonly payload: ConfigProposalApplyableV1
  readonly shownDiff: string
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

/**
 * File a pre-432 `config.field.set`-style proposal over the config as it stands now.
 *
 * `edits` are applied to the config file through the shipped yaml port; `files` replace whole set
 * members (a hooks file, a `.gitignore`). `crossBoundaryReasons` is what the old classifier
 * recorded on the record — a historical fact the apply path still reads.
 */
export async function filePre432ConfigProposal(input: {
  readonly configPath: string
  readonly agentQaRoot: string
  readonly action?: string
  readonly edits?: readonly { readonly path: string; readonly value: ConfigStructuredValue }[]
  readonly files?: readonly { readonly path: string; readonly bytes: Uint8Array }[]
  readonly summaryLine?: string
  readonly crossBoundaryReasons?: readonly CrossBoundaryReason[]
  readonly surface?: string
  readonly now?: () => number
}): Promise<Pre432ConfigProposal> {
  const port = createConfigFilesPort(input.configPath)
  const set = await port.read()
  const config = set.files.find((file) => file.path === set.configFile)

  const written = new Map<string, Uint8Array>()
  let bytes = config?.bytes
  for (const edit of input.edits ?? []) {
    bytes = (await port.setField({
      ...(bytes === undefined ? {} : { bytes }),
      path: edit.path,
      value: edit.value,
    })).bytes
  }
  if (bytes !== undefined && config !== undefined && (input.edits ?? []).length > 0) {
    written.set(config.path, bytes)
  }
  for (const file of input.files ?? []) written.set(file.path, file.bytes)

  const committed = new Map(set.files.map((file) => [file.path, file.bytes]))
  const diffInput: ConfigDiffFileInput[] = []
  for (const [path, next] of written) {
    const before = committed.get(path)
    if (before !== undefined && sameBytes(before, next)) continue
    diffInput.push({ path, ...(before === undefined ? {} : { oldBytes: before }), newBytes: next })
  }
  const rendered = renderConfigDiff(diffInput)
  if (rendered.outcome !== 'changed') throw new Error('the pre-432 proposal fixture changes nothing')

  const digests = new Map(rendered.perFileDigests.map((digest) => [digest.path, digest]))
  const action = input.action ?? 'config.field.set'
  const firstEdit = input.edits?.[0]
  const reasons = [...(input.crossBoundaryReasons ?? [])]
  const payload: ConfigProposalApplyableV1 = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'applyable',
    action,
    summaryLine: input.summaryLine
      ?? (firstEdit === undefined ? `${action} change` : `set ${firstEdit.path} to ${String(firstEdit.value)}`),
    files: rendered.changes.map((change) => {
      const oldDigest = digests.get(change.path)?.oldDigest
      return {
        path: change.path,
        changeKind: change.changeKind,
        ...(oldDigest === undefined ? {} : { baseDigest: oldDigest }),
        newContentBase64: base64Encode(written.get(change.path) as Uint8Array),
      }
    }),
    shownDiffBase64: base64Encode(rendered.diffBytes),
    shownDiffDigest: rendered.diffDigest,
    crossBoundary: reasons.length > 0,
    crossBoundaryReasons: reasons,
  }

  const now = input.now ?? Date.now
  const proposalId = mintProposalId(() => `${now()}-${Math.floor(performance.now())}`)
  writePendingProposalRecord(input.agentQaRoot, {
    schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
    id: proposalId,
    kind: 'config',
    origin: {
      emittedBy: action,
      at: now(),
      ...(input.surface === undefined ? {} : { surface: input.surface }),
    },
    payload,
  } as ProposalRecord)

  return { proposalId, payload, shownDiff: utf8Decode(rendered.diffBytes) }
}
