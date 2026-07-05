// Run-end redacted working-memory flush (Phase 358 · WM-02 · D-13 · Pattern 7 · Open Q2 ·
// Pitfall 5). This is the FIRST LIVE composition of the Phase 347 committed-egress checkpoint
// (`assertCommittedEgressSafe`) — composing it into a JSON artifact discharges MASK-FUT-02.
// No new scanning/redaction plumbing is invented (D-13): values are masked, then routed through
// the shipped fail-closed guardrail, then written to the existing `.agent-qa/artifacts` location.
//
// Boundary contract (Pitfall 7 boundary 3): mask() applies ONLY here at flush; the store and
// turn content stay verbatim. Open Q2 disposition: a blocked entry's value is replaced by a
// `[blocked:<detector>:<redactedFingerprint>]` placeholder — the artifact ALWAYS exists, no raw
// secret ever lands, and the flush NEVER throws (Pitfall 5: the run exit code is untouched).
//
// Phase 361 relocates this artifact into `CompletedRunHandoff` without touching the flush logic.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertCommittedEgressSafe,
  CommittedEgressBlockedError,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import type {
  AuditSink,
  BlockedDetection,
  CommittedEgressPart,
} from '@vostride/agent-qa-safety'

const WORKING_MEMORY_FLUSH_CHANNEL = 'working-memory-flush'

/** The guardrail policy shape (schema-owned) without importing schema into the surface package. */
type GuardrailPolicy = ReturnType<typeof loadGuardrailPolicy>

/**
 * Structural view of one working-memory entry the flush needs. Kept local (not imported from
 * schema) so the surface package's dependency set stays unchanged — the store's `WorkingMemoryEntry`
 * satisfies it by construction.
 */
interface FlushEntry {
  key: string
  value: string
  kind: string
  provenance: string
  testIndex?: number
  stepIndex?: number
}

/**
 * Structural view of the run-scoped store at flush time (WM store's `entries`/`dispose` satisfy it).
 */
export interface WorkingMemoryFlushSource {
  entries(): readonly FlushEntry[]
  dispose(): void
}

export interface FlushWorkingMemoryOptions {
  /** Directory the CLI already owns (`.agent-qa/artifacts`); created if missing. */
  artifactsDir: string
  /** Mask applied to every value before the guardrail (identity pre-362 when no MaskingContext). */
  mask?: (value: string) => string
  /** Guardrail policy; defaults to the shipped `defaultGuardrailPolicyInput`, injectable for tests. */
  policy?: GuardrailPolicy
  /** Optional audit sink; the checkpoint appends guardrail rows before any block (Phase 347 machinery). */
  auditSink?: AuditSink
}

export interface FlushWorkingMemoryResult {
  /** Path of the written artifact (empty string only if the write itself failed — never throws). */
  path: string
  /** Number of entries the store held at flush time. */
  entriesWritten: number
  /** Detections that blocked (each entry's value was placeholdered); empty on the clean path. */
  blocked: BlockedDetection[]
}

/**
 * Flush the run-scoped working memory redacted: mask every value → `assertCommittedEgressSafe`
 * (channel `working-memory-flush`, the Phase 347 checkpoint) → JSON artifact → dispose the store.
 *
 * Resolves best-effort and never rejects (Pitfall 5): a blocked entry is fingerprint-placeholdered,
 * unexpected internal errors are swallowed, and the store is always disposed — so run teardown and
 * the exit code are untouched.
 */
export async function flushWorkingMemory(
  store: WorkingMemoryFlushSource,
  options: FlushWorkingMemoryOptions,
): Promise<FlushWorkingMemoryResult> {
  const {
    artifactsDir,
    mask = (value: string) => value,
    policy = loadGuardrailPolicy(defaultGuardrailPolicyInput),
    auditSink,
  } = options

  let entries: FlushEntry[] = []
  const blocked: BlockedDetection[] = []
  const blockedByKey = new Map<string, BlockedDetection>()
  const maskedByKey = new Map<string, string>()

  try {
    entries = [...store.entries()]

    for (const entry of entries) {
      let masked: string
      try {
        masked = mask(entry.value)
      } catch {
        // A misbehaving mask must never leak a raw value — fall back to a coded blank.
        masked = '[mask-error]'
      }
      maskedByKey.set(entry.key, masked)
    }

    // One part per entry (Open Q2): a single blocked entry never suppresses the rest.
    const parts: CommittedEgressPart[] = entries.map((entry) => ({
      label: entry.key,
      text: maskedByKey.get(entry.key) ?? '',
    }))

    try {
      assertCommittedEgressSafe(parts, {
        policy,
        channel: WORKING_MEMORY_FLUSH_CHANNEL,
        auditSink,
      })
    } catch (err) {
      if (err instanceof CommittedEgressBlockedError) {
        // Audit rows were already appended by the checkpoint before this throw (preserved).
        for (const detection of err.blocked) {
          blocked.push(detection)
          if (!blockedByKey.has(detection.label)) {
            blockedByKey.set(detection.label, detection)
          }
        }
      }
      // Any other (unexpected) error is swallowed — the artifact below still carries masked
      // values, and the flush must never worsen the run's exit code (Pitfall 5).
    }

    const flushedAt = new Date().toISOString()
    const artifactEntries = entries.map((entry) => {
      const detection = blockedByKey.get(entry.key)
      const value = detection
        ? `[blocked:${detection.detector}:${detection.redactedFingerprint}]`
        : (maskedByKey.get(entry.key) ?? '')
      const out: FlushEntry = {
        key: entry.key,
        value,
        kind: entry.kind,
        provenance: entry.provenance,
      }
      if (entry.testIndex !== undefined) out.testIndex = entry.testIndex
      if (entry.stepIndex !== undefined) out.stepIndex = entry.stepIndex
      return out
    })

    const artifact = {
      kind: WORKING_MEMORY_FLUSH_CHANNEL,
      channel: WORKING_MEMORY_FLUSH_CHANNEL,
      flushedAt,
      entryCount: entries.length,
      blockedCount: blocked.length,
      entries: artifactEntries,
      blocked: blocked.map((detection) => ({
        label: detection.label,
        detector: detection.detector,
        action: detection.action,
        redactedFingerprint: detection.redactedFingerprint,
      })),
    }

    let path = ''
    try {
      await mkdir(artifactsDir, { recursive: true })
      path = join(
        artifactsDir,
        `working-memory-flush-${flushedAt.replace(/[:.]/g, '-')}.json`,
      )
      await writeFile(path, JSON.stringify(artifact, null, 2), 'utf8')
    } catch {
      // Best-effort: a failed write must not crash run teardown.
      path = ''
    }

    return { path, entriesWritten: entries.length, blocked }
  } finally {
    // WM-02 disposal always runs — on the clean path, the blocked path, and any error path.
    try {
      store.dispose()
    } catch {
      /* disposal must never throw out of teardown */
    }
  }
}
