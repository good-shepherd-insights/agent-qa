import { createHash } from 'node:crypto'
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
  appendOutcomeEventWithEnrichment,
  appendRelation,
  type AppendOutcome,
} from '../bundle-append.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.js'
import { commitBundleMutation } from '../journal/bundle-mutation.js'
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
      writerLeaseId: 'lease-append-fixture',
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
        authorship: {
          path: 'deterministic-fallback',
          executionContext: 'local-headless',
        },
        needsEnrichment: true,
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

  function mutationDirs(): string[] {
    const stagingRoot = join(bundleDir, '..', '.staging')
    return existsSync(stagingRoot)
      ? readdirSync(stagingRoot).filter((name) => name.includes('-mutation-')).sort()
      : []
  }

  function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
  }

  it('stages one complete outcome mutation, applies the manifest last, and removes the journal', () => {
    const replacementOrder: string[] = []
    let durableJournalObserved = false
    config.hooks = {
      afterMutableReplacement(relPath) {
        replacementOrder.push(relPath)
        if (relPath !== 'evidence/outcomes.jsonl') return

        const [transactionName] = mutationDirs()
        expect(transactionName).toMatch(/^lease-append-fixture-mutation-/)
        const transactionDir = join(bundleDir, '..', '.staging', transactionName!)
        const journal = JSON.parse(
          readFileSync(join(transactionDir, 'mutation.json'), 'utf8'),
        ) as {
          leaseId: string
          bundleId: string
          replacements: {
            targetRelPath: string
            recoveryRelPath: string
            sha256: string
            manifest: boolean
          }[]
        }
        expect(journal).toMatchObject({
          leaseId: config.writerLeaseId,
          bundleId: id,
        })
        expect(journal.replacements.map(({ targetRelPath, manifest }) => ({
          targetRelPath,
          manifest,
        }))).toEqual([
          { targetRelPath: 'evidence/outcomes.jsonl', manifest: false },
          { targetRelPath: 'manifest.json', manifest: true },
        ])
        for (const replacement of journal.replacements) {
          expect(
            sha256(readFileSync(join(transactionDir, replacement.recoveryRelPath))),
          ).toBe(replacement.sha256)
        }
        durableJournalObserved = true
      },
    }

    expect(appendOutcomeEvent(config, id, event())).toEqual<AppendOutcome>({
      kind: 'appended',
    })

    expect(durableJournalObserved).toBe(true)
    expect(replacementOrder).toEqual(['evidence/outcomes.jsonl', 'manifest.json'])
    expect(mutationDirs()).toEqual([])
  })

  it('retains every immutable recovery payload when enrichment stops after the first target', () => {
    const before = Object.fromEntries(
      ['record.md', 'provenance.json', 'evidence/outcomes.jsonl', 'manifest.json'].map(
        (relPath) => [relPath, readFileSync(join(bundleDir, relPath))],
      ),
    )
    config.hooks = {
      afterMutableReplacement(relPath) {
        if (relPath === 'record.md') throw new Error('injected mutable stop')
      },
    }

    expect(() =>
      appendOutcomeEventWithEnrichment(config, id, event(), {
        summary: 'Capable-model checkout selector',
        body: 'The checkout selector was re-authored from verified evidence.',
        authorship: {
          path: 'llm',
          model: { id: 'capable-curator' },
          executionContext: 'local-interactive',
        },
      }),
    ).toThrow('injected mutable stop')

    expect(readFileSync(join(bundleDir, 'record.md'))).not.toEqual(before['record.md'])
    expect(readFileSync(join(bundleDir, 'provenance.json'))).toEqual(before['provenance.json'])
    expect(readFileSync(join(bundleDir, 'evidence/outcomes.jsonl'))).toEqual(
      before['evidence/outcomes.jsonl'],
    )
    expect(readFileSync(join(bundleDir, 'manifest.json'))).toEqual(before['manifest.json'])

    const [transactionName] = mutationDirs()
    expect(transactionName).toMatch(/^lease-append-fixture-mutation-/)
    const transactionDir = join(bundleDir, '..', '.staging', transactionName!)
    const journal = JSON.parse(
      readFileSync(join(transactionDir, 'mutation.json'), 'utf8'),
    ) as {
      replacements: {
        targetRelPath: string
        recoveryRelPath: string
        sha256: string
        manifest: boolean
      }[]
    }
    expect(journal.replacements.map(({ targetRelPath }) => targetRelPath)).toEqual([
      'record.md',
      'provenance.json',
      'evidence/outcomes.jsonl',
      'manifest.json',
    ])
    for (const replacement of journal.replacements) {
      const recoveryBytes = readFileSync(join(transactionDir, replacement.recoveryRelPath))
      expect(sha256(recoveryBytes)).toBe(replacement.sha256)
    }
  })

  it('rejects traversal and unexpected mutable targets before changing canonical bytes', () => {
    const recordBefore = readFileSync(join(bundleDir, 'record.md'))
    const manifestBefore = readFileSync(join(bundleDir, 'manifest.json'))
    const baseInput = {
      knowledgeRoot: config.knowledgeRoot,
      bundleDir,
      bundleId: id,
      writerLeaseId: config.writerLeaseId!,
    }

    expect(() =>
      commitBundleMutation({
        ...baseInput,
        replacements: [
          { targetRelPath: '../record.md', text: 'escaped' },
          { targetRelPath: 'manifest.json', text: manifestBefore.toString('utf8') },
        ],
      }),
    ).toThrow()
    expect(() =>
      commitBundleMutation({
        ...baseInput,
        replacements: [
          { targetRelPath: 'notes.txt', text: 'unexpected' },
          { targetRelPath: 'manifest.json', text: manifestBefore.toString('utf8') },
        ],
      }),
    ).toThrow()

    expect(readFileSync(join(bundleDir, 'record.md'))).toEqual(recordBefore)
    expect(readFileSync(join(bundleDir, 'manifest.json'))).toEqual(manifestBefore)
    expect(mutationDirs()).toEqual([])
  })

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
    expect(mutationDirs()).toEqual([])
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
    expect(mutationDirs()).toEqual([])
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
