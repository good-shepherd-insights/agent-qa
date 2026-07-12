import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  asEvidenceToken,
  asRecordId,
  canonicalJson,
  committedFileText,
  guardBundleManifest,
  guardBundleRelations,
} from '@vostride/agent-qa-schema'
import type {
  BundleOutcomeEvent,
  BundleRelation,
  RecordId,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  appendOutcomeEvent,
  appendRelation,
  type AppendOutcome,
} from '../bundle-append.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function event(
  overrides: Partial<Extract<BundleOutcomeEvent, { type: 'confirmed' }>> = {},
): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse({
    type: 'confirmed',
    evidenceToken: 'append-confirmed',
    curationJobId: 'append-job',
    buildOrdinal: 43,
    origin: 'agent-verified',
    ...overrides,
  })
}

function relation(overrides: Partial<BundleRelation> = {}): BundleRelation {
  return {
    type: 'relates-to',
    targetId: 'fact-target-0123456789abcdef',
    addedAtOrdinal: 43,
    curationJobId: 'append-relation-job',
    ...overrides,
  }
}

describe('bundle append atomic checkpoint units (D-11/BNDL-03)', () => {
  let root: string
  let config: BundleStoreConfig
  let id: RecordId
  let bundleDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-bundle-append-'))
    config = {
      knowledgeRoot: join(root, 'agent-qa-knowledge'),
      productKey: 'Example Store / production',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
    const input: PublishBundleInput = {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [
        event({
          evidenceToken: asEvidenceToken('publish-confirmed'),
          curationJobId: 'publish-job',
          buildOrdinal: 42,
        }),
      ],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'append-run',
        testId: 'append-sign-in',
        stepIndex: 0,
      },
      artifacts: [],
    }
    const published = publishBundle(config, input)
    if (published.kind !== 'published') throw new Error('expected fixture bundle publication')
    id = published.id
    bundleDir = published.dir
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function manifest() {
    return guardBundleManifest(
      JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8')),
    )
  }

  it('appends exactly one canonical event and advances only mutable identity', () => {
    const appendedEvent = event()
    const outcomesPath = join(bundleDir, 'evidence', 'outcomes.jsonl')
    const outcomesBefore = readFileSync(outcomesPath, 'utf8')
    const manifestBefore = manifest()

    expect(appendOutcomeEvent(config, id, appendedEvent)).toEqual<AppendOutcome>({
      kind: 'appended',
    })

    const outcomesAfter = readFileSync(outcomesPath, 'utf8')
    const manifestAfter = manifest()
    expect(outcomesAfter).toBe(`${outcomesBefore}${canonicalJson(appendedEvent)}\n`)
    expect(manifestAfter.contentHashes['evidence/outcomes.jsonl']).not.toBe(
      manifestBefore.contentHashes['evidence/outcomes.jsonl'],
    )
    expect(manifestAfter.mutableStateHash).not.toBe(manifestBefore.mutableStateHash)
    expect({
      id: manifestAfter.id,
      identityHash: manifestAfter.identityHash,
      complete: manifestAfter.complete,
      evidenceIncomplete: manifestAfter.evidenceIncomplete,
    }).toEqual({
      id: manifestBefore.id,
      identityHash: manifestBefore.identityHash,
      complete: manifestBefore.complete,
      evidenceIncomplete: manifestBefore.evidenceIncomplete,
    })
    expect(readdirSync(join(bundleDir, 'evidence')).some((name) => name.includes('.tmp'))).toBe(
      false,
    )
    expect(readdirSync(bundleDir).some((name) => name.includes('.tmp'))).toBe(false)
  })

  it('returns duplicate without changing event-log or manifest bytes', () => {
    const duplicate = event({
      evidenceToken: asEvidenceToken('publish-confirmed'),
      curationJobId: 'publish-job',
      buildOrdinal: 999,
    })
    const outcomesPath = join(bundleDir, 'evidence', 'outcomes.jsonl')
    const manifestPath = join(bundleDir, 'manifest.json')
    const outcomesBefore = readFileSync(outcomesPath)
    const manifestBefore = readFileSync(manifestPath)

    expect(appendOutcomeEvent(config, id, duplicate)).toEqual<AppendOutcome>({
      kind: 'duplicate',
    })
    expect(readFileSync(outcomesPath)).toEqual(outcomesBefore)
    expect(readFileSync(manifestPath)).toEqual(manifestBefore)
  })

  it('blocks detector-shaped event payloads with audit and zero committed writes', () => {
    const blocked = BundleOutcomeEventSchema.parse({
      type: 'deprecated',
      evidenceToken: 'append-secret',
      curationJobId: 'append-secret-job',
      buildOrdinal: 43,
      reason: `credential ${AWS_KEY}`,
    })
    const outcomesPath = join(bundleDir, 'evidence', 'outcomes.jsonl')
    const manifestPath = join(bundleDir, 'manifest.json')
    const outcomesBefore = readFileSync(outcomesPath)
    const manifestBefore = readFileSync(manifestPath)

    const outcome = appendOutcomeEvent(config, id, blocked)

    expect(outcome.kind).toBe('egress-blocked')
    expect(readFileSync(outcomesPath)).toEqual(outcomesBefore)
    expect(readFileSync(manifestPath)).toEqual(manifestBefore)
    expect(readFileSync(join(config.auditBaseDir, 'guardrail_audit.jsonl'), 'utf8')).toContain(
      'knowledge-bundle:evidence/outcomes.jsonl',
    )
  })

  it('appends, deduplicates, and blocks relations with the pinned relation key', () => {
    const relationsPath = join(bundleDir, 'relations.json')
    const manifestPath = join(bundleDir, 'manifest.json')
    const first = relation()

    expect(appendRelation(config, id, first)).toEqual<AppendOutcome>({ kind: 'appended' })
    const parsed = guardBundleRelations(JSON.parse(readFileSync(relationsPath, 'utf8')))
    expect(parsed.relations).toEqual([first])
    const relationsAfterAppend = readFileSync(relationsPath)
    const manifestAfterAppend = readFileSync(manifestPath)

    expect(
      appendRelation(
        config,
        id,
        relation({ addedAtOrdinal: 999 }),
      ),
    ).toEqual<AppendOutcome>({ kind: 'duplicate' })
    expect(readFileSync(relationsPath)).toEqual(relationsAfterAppend)
    expect(readFileSync(manifestPath)).toEqual(manifestAfterAppend)

    const blocked = appendRelation(
      config,
      id,
      relation({
        targetId: `fact-${AWS_KEY}`,
        curationJobId: 'append-secret-relation-job',
      }),
    )
    expect(blocked.kind).toBe('egress-blocked')
    expect(readFileSync(relationsPath)).toEqual(relationsAfterAppend)
    expect(readFileSync(manifestPath)).toEqual(manifestAfterAppend)
  })

  it('treats missing and incomplete bundles as not found', () => {
    expect(
      appendOutcomeEvent(config, asRecordId('missing-bundle'), event()),
    ).toEqual<AppendOutcome>({ kind: 'not-found' })

    const manifestPath = join(bundleDir, 'manifest.json')
    writeFileSync(manifestPath, committedFileText({ ...manifest(), complete: false }))
    const manifestBefore = readFileSync(manifestPath)
    const outcomesPath = join(bundleDir, 'evidence', 'outcomes.jsonl')
    const outcomesBefore = readFileSync(outcomesPath)

    expect(appendOutcomeEvent(config, id, event())).toEqual<AppendOutcome>({
      kind: 'not-found',
    })
    expect(readFileSync(manifestPath)).toEqual(manifestBefore)
    expect(readFileSync(outcomesPath)).toEqual(outcomesBefore)
    expect(existsSync(join(bundleDir, 'manifest.json.tmp'))).toBe(false)
  })
})
