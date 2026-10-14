import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildEvalReport, committedFileText, projectBaselinePointer } from '@vostride/agent-qa-eval'
import type { BaselinePointer, EvalBatchReport } from '@vostride/agent-qa-eval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FsCommittedRootStore, committedBaselinePointerPath } from '../committed-root-store.js'
import { writeBaselinePointer } from '../baseline-pointer.js'
import type { WriteBaselinePointerOutcome } from '../baseline-pointer.js'

/**
 * Byte-copied from the committed D-18 fixture's `judge` block:
 * demo/init/agent-qa-eval/reports/358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e/report.json
 */
const FIXTURE_JUDGE_BLOCK = {
  confidenceThreshold: 'high',
  familyOverride: 'same-family-allowed',
  judgeFamily: 'openai',
  judgeModelId: 'gpt-5.6-sol',
  judgeVersion: 1,
} as const

const FIXTURE_BATCH_KEY = '358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e'

describe('writeBaselinePointer (D-19/D-20, ROOT-11)', () => {
  let root: string
  let outDir: string
  let report: EvalBatchReport
  let pointer: BaselinePointer

  function write(
    overrides: {
      report?: EvalBatchReport
      pointer?: BaselinePointer
    } = {},
  ): WriteBaselinePointerOutcome {
    return writeBaselinePointer({
      report: overrides.report ?? report,
      pointer: overrides.pointer ?? pointer,
      committedRoot: root,
      reportOutputBaseDir: outDir,
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-baseline-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-baseline-out-'))
    report = buildEvalReport([])
    pointer = projectBaselinePointer({
      plannerModelId: 'gpt-5.6-terra',
      fingerprint: 'fp-fixture',
      corpusDigest: 'digest-fixture',
      matcherVersion: 1,
      batchKey: report.batchKey,
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('designates the baseline at reports/baselines/<slug(profileKey)>.json (happy path)', () => {
    const relPath = committedBaselinePointerPath(pointer.profileKey)
    expect(relPath).toBe(
      'reports/baselines/planner-gpt-5.6-terra-fingerprint-fp-fixture-matcher-1-judge-none-judgeVersion-none.json',
    )

    expect(write()).toEqual({ kind: 'written', path: relPath })
    expect(pointer.schemaVersion).toBe(2)
    expect(readFileSync(join(root, relPath), 'utf8')).toBe(committedFileText(pointer))
  })

  it('re-designating the same batch is an idempotent no-op (371 D-17)', () => {
    const relPath = committedBaselinePointerPath(pointer.profileKey)
    write()
    const before = readFileSync(join(root, relPath))

    expect(write()).toEqual({ kind: 'unchanged', path: relPath })
    expect(readFileSync(join(root, relPath)).equals(before)).toBe(true)
  })

  it('refuses to move a baseline in place — a move is a reviewed git edit (D-19)', () => {
    const relPath = committedBaselinePointerPath(pointer.profileKey)
    const store = new FsCommittedRootStore({ committedRoot: root })
    const previous = committedFileText({ ...pointer, batchKey: 'a-previously-designated-batch' })
    store.writeText(relPath, previous)

    expect(write()).toEqual({ kind: 'write-conflict', path: relPath })
    expect(readFileSync(join(root, relPath), 'utf8')).toBe(previous)
  })

  it('refuses a same-family report BEFORE the checkpoint — no file, no audit row (ROOT-11)', () => {
    const sameFamily: EvalBatchReport = {
      ...buildEvalReport([], { ...FIXTURE_JUDGE_BLOCK }),
      batchKey: FIXTURE_BATCH_KEY,
    }
    const sameFamilyPointer = projectBaselinePointer({
      plannerModelId: 'gpt-5.6-terra',
      fingerprint: 'fp-fixture',
      corpusDigest: 'digest-fixture',
      matcherVersion: 1,
      judgeModelId: FIXTURE_JUDGE_BLOCK.judgeModelId,
      judgeVersion: FIXTURE_JUDGE_BLOCK.judgeVersion,
      batchKey: FIXTURE_BATCH_KEY,
    })

    expect(write({ report: sameFamily, pointer: sameFamilyPointer })).toEqual({
      kind: 'refused',
      refusal: {
        kind: 'same-family-override',
        judgeModelId: 'gpt-5.6-sol',
        judgeFamily: 'openai',
        batchKey: FIXTURE_BATCH_KEY,
      },
    })

    expect(existsSync(join(root, committedBaselinePointerPath(sameFamilyPointer.profileKey)))).toBe(
      false,
    )
    expect(existsSync(join(outDir, 'guardrail_audit.jsonl'))).toBe(false)
  })
})
