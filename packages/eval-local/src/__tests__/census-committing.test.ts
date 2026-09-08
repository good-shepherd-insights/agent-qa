import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { committedFileText, deriveCensus, renderCensusMarkdown } from '@vostride/agent-qa-eval'
import type { CorpusCensus } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  COMMITTED_CENSUS_SUBDIR,
  COMMITTED_REPORTS_DIR,
  FsCommittedRootStore,
  committedCensusPath,
} from '../committed-root-store.js'
import {
  COMMITTED_CENSUS_JSON_FILE,
  COMMITTED_CENSUS_MARKDOWN_FILE,
  commitCensus,
} from '../census-committing.js'
import type { CommitCensusOutcome } from '../census-committing.js'
import { REPORT_EGRESS_CHANNEL } from '../report-committing.js'
import { listCommittedReports } from '../committed-corpus-source.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const MARKDOWN = '# Corpus Census\n\nentries: 0\n'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

describe('commitCensus (413 D-15/D-16)', () => {
  let root: string
  let outDir: string
  let census: CorpusCensus

  function commit(overrides: { markdown?: string } = {}): CommitCensusOutcome {
    return commitCensus({
      census,
      markdown: overrides.markdown ?? MARKDOWN,
      committedRoot: root,
      censusOutputBaseDir: outDir,
      policy,
    })
  }

  function censusFilePaths(): { json: string; markdown: string } {
    return {
      json: join(root, committedCensusPath(census.corpusDigest, COMMITTED_CENSUS_JSON_FILE)),
      markdown: join(
        root,
        committedCensusPath(census.corpusDigest, COMMITTED_CENSUS_MARKDOWN_FILE),
      ),
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-census-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-census-out-'))
    census = deriveCensus({
      snapshot: {
        entries: [],
        labelsById: new Map(),
        cassettesById: new Map(),
        blobPresentById: new Map(),
      },
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('commits census.json + census.md under reports/census/<slug(corpusDigest)>/', () => {
    const outcome = commit()

    expect(outcome.kind).toBe('committed')
    if (outcome.kind !== 'committed') throw new Error('expected committed outcome')
    expect(outcome.json).toBe('written')
    expect(outcome.markdown).toBe('written')
    expect(outcome.censusDir).toBe(
      join(root, COMMITTED_REPORTS_DIR, COMMITTED_CENSUS_SUBDIR, slugBranch(census.corpusDigest)),
    )

    const paths = censusFilePaths()
    expect(readFileSync(paths.json, 'utf8')).toBe(committedFileText(census))
    expect(readFileSync(paths.markdown, 'utf8')).toBe(MARKDOWN)
  })

  it('commits a census over a root with noise-floor without a report.json absent notice', () => {
    mkdirSync(join(root, 'reports/noise-floor'), { recursive: true })
    expect(commit().kind).toBe('committed')
    expect(listCommittedReports(root)).toEqual({ reports: [], refusals: [] })
  })

  it('re-committing the byte-identical census is an idempotent no-op (D-15)', () => {
    commit()
    const paths = censusFilePaths()
    const jsonBefore = readFileSync(paths.json)
    const markdownBefore = readFileSync(paths.markdown)

    const second = commit()

    expect(second.kind).toBe('committed')
    if (second.kind !== 'committed') throw new Error('expected committed outcome')
    expect(second.json).toBe('unchanged')
    expect(second.markdown).toBe('unchanged')
    expect(readFileSync(paths.json).equals(jsonBefore)).toBe(true)
    expect(readFileSync(paths.markdown).equals(markdownBefore)).toBe(true)
  })

  it('re-derived pre-419 unmarked census keeps its existing committed bytes', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../eval/src/census/__tests__/fixtures/pre419-unmarked-census.json', import.meta.url), 'utf8'))
    // The fixture is the prior producer's exact JSON, not a new expectation from this renderer.
    census = fixture
    const markdown = renderCensusMarkdown(census)
    expect(commit({ markdown }).kind).toBe('committed')
    expect(commit({ markdown: renderCensusMarkdown(structuredClone(census)) })).toMatchObject({
      kind: 'committed', json: 'unchanged', markdown: 'unchanged',
    })
  })

  it('refuses divergent bytes at the same corpus digest atomically — nothing modified', () => {
    const store = new FsCommittedRootStore({ committedRoot: root })
    const markdownRel = committedCensusPath(census.corpusDigest, COMMITTED_CENSUS_MARKDOWN_FILE)
    store.writeText(markdownRel, '# a different census body\n')

    const outcome = commit()

    expect(outcome).toEqual({ kind: 'write-conflict', path: markdownRel })
    const paths = censusFilePaths()
    expect(existsSync(paths.json)).toBe(false)
    expect(readFileSync(paths.markdown, 'utf8')).toBe('# a different census body\n')
  })

  it('refuses the WHOLE census on a guardrail detection — typed, audited, nothing lands', async () => {
    const outcome = commit({ markdown: `# leaky census\n\nkey: ${AWS_KEY}\n` })

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected egress-blocked outcome')
    expect(
      outcome.detections.some(
        (detection) =>
          detection.detector === 'awsKey' &&
          detection.label === `census-markdown:${census.corpusDigest}`,
      ),
    ).toBe(true)

    const paths = censusFilePaths()
    expect(existsSync(paths.json)).toBe(false)
    expect(existsSync(paths.markdown)).toBe(false)

    const auditRaw = await readFile(join(outDir, 'guardrail_audit.jsonl'), 'utf8')
    const rows = auditRaw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { channel: string; detector: string; action: string })
    expect(
      rows.some(
        (row) =>
          row.channel === `${REPORT_EGRESS_CHANNEL}:census-markdown:${census.corpusDigest}` &&
          row.detector === 'awsKey' &&
          row.action === 'block',
      ),
    ).toBe(true)
  })
})
