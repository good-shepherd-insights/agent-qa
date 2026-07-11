import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

import { buildEvalReport, computeBatchKey } from '@vostride/agent-qa-eval'
import type { EvalBatchReport } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_EVAL_REPORTS_SUBDIR, FsReportStore } from '../report-store.js'

function report(batchKey?: string): EvalBatchReport {
  // A real eval-core report DTO — the store persists it verbatim (F9: no aggregation here).
  const built = buildEvalReport([])
  return batchKey === undefined ? built : { ...built, batchKey }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

describe('FsReportStore (D-13/D-14)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-reports-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes <slugged batchKey>.json under root/eval/reports/ with deterministic bytes', async () => {
    expect(DEFAULT_EVAL_REPORTS_SUBDIR).toBe('eval/reports')

    const batchReport = report()
    expect(batchReport.batchKey).toBe(computeBatchKey([]))
    const written = new FsReportStore({ root }).save(batchReport)

    const expected = join(
      root,
      DEFAULT_EVAL_REPORTS_SUBDIR,
      `${slugBranch(batchReport.batchKey)}.json`,
    )
    expect(written.file).toBe(expected)

    const raw = await readFile(expected, 'utf8')
    expect(raw).toBe(`${JSON.stringify(batchReport, null, 2)}\n`)
    expect(JSON.parse(raw)).toEqual(batchReport)
  })

  it('rerun-stable: same batch key overwrites, a different key lands beside it untouched', async () => {
    const store = new FsReportStore({ root })

    const first = store.save({ ...report('batch-alpha'), modelMismatchCount: 1 })
    const rerun = store.save({ ...report('batch-alpha'), modelMismatchCount: 2 })
    expect(rerun.file).toBe(first.file)
    const rerunRaw = await readFile(rerun.file, 'utf8')
    expect((JSON.parse(rerunRaw) as EvalBatchReport).modelMismatchCount).toBe(2)

    const sibling = store.save(report('batch-beta'))
    expect(sibling.file).not.toBe(first.file)
    expect(await exists(first.file)).toBe(true)
    expect((JSON.parse(await readFile(first.file, 'utf8')) as EvalBatchReport).modelMismatchCount).toBe(2)
  })

  it('contains a hostile batchKey inside the reports root via slugBranch', async () => {
    const written = new FsReportStore({ root }).save(report('../../../escape/..\\evil'))

    const reportsRoot = join(root, DEFAULT_EVAL_REPORTS_SUBDIR)
    expect(relative(reportsRoot, written.file).startsWith('..')).toBe(false)
    expect(await exists(written.file)).toBe(true)

    // Nothing escapes the temp root: it contains only the eval/ staging subtree.
    expect(await readdir(root)).toEqual(['eval'])
  })

  it('honors an explicit outputDir override', async () => {
    const outputDir = join(root, 'retargeted-reports')
    const batchReport = report('batch-gamma')
    const written = new FsReportStore({ root, outputDir }).save(batchReport)

    expect(written.file).toBe(join(outputDir, `${slugBranch('batch-gamma')}.json`))
    expect(await exists(join(root, DEFAULT_EVAL_REPORTS_SUBDIR))).toBe(false)
  })
})
