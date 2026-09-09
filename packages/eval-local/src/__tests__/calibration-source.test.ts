import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { calibrateLabels, canonicalJson, createLabelRevision, extractRunCassettes, projectCorpusEntry, projectSilverLabelRecord } from '@vostride/agent-qa-eval'
import { asRunId, sha256hex } from '@vostride/agent-qa-schema'
import * as api from '../index.js'
import { committedCassettePath, committedCorpusPath, committedLabelPath } from '../committed-root-store.js'
import { makeLocalV2Handoff, LOCAL_FIXTURE_BLOB_BYTES } from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const reader = (root: string) => (api as Record<string, any>).readLabelCalibration?.(root)
function write(root: string, path: string, value: unknown) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, JSON.stringify(value))
  return full
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-calibration-read-'))
  roots.push(root)
  const handoff = makeLocalV2Handoff()
  handoff.runId = asRunId('calibration-reader-fixture')
  const cassette = extractRunCassettes({ handoff, artifacts: { getBlob: () => LOCAL_FIXTURE_BLOB_BYTES } }).cassettes[0]!.cassette
  if (cassette.granularity !== 'leaf') throw new Error('leaf fixture required')
  const entry = projectCorpusEntry({ cassette, product: 'fixture', runId: handoff.runId, assignment: { split: 'natural' } })
  const base = projectSilverLabelRecord({ cassette, runId: handoff.runId })
  write(root, committedCassettePath('fixture', cassette.id), cassette)
  write(root, committedCorpusPath('fixture', cassette.id), entry)
  write(root, committedLabelPath('fixture', cassette.id), base)
  const next = createLabelRevision(base, { provenance: { ...base.provenance, rerun: { attempt: 1 } } }, 'older-generation')
  const terminal = createLabelRevision(next, { provenance: { ...base.provenance, rerun: { attempt: 2 } } }, 'newer-generation')
  const append = (record: typeof next) => write(root, committedLabelPath('fixture', record.cassetteId).replace(/\.json$/, `--revision-${record.revision!.id}.json`), record)
  const report = calibrateLabels({ snapshot: api.readCommittedCorpus(root).snapshot, marks: [] })
  const body = { ...report, schemaVersion: 1, evidenceDigest: sha256hex('evidence'), targetRevisions: [{ cassetteId: base.cassetteId, revisionId: terminal.revision!.id }] }
  const artifact = { ...body, generationId: sha256hex(canonicalJson(body)) }
  return { root, base, next, terminal, append, artifact }
}
it('reports missing calibration as absent and preserves provisional labels', () => {
  const f = setup()
  expect(reader(f.root)?.kind).toBe('absent')
  expect(api.readCommittedCorpus(f.root).snapshot.labelsById.get(f.base.cassetteId)).toEqual(f.base)
})
it('activates only a complete terminal and its older generation ancestry', () => {
  const f = setup()
  f.append(f.terminal)
  f.append(f.next)
  write(f.root, 'labels/calibration.json', f.artifact)
  expect(reader(f.root)?.kind).toBe('loaded')
  expect(api.readCommittedCorpus(f.root).snapshot.labelsById.get(f.base.cassetteId)).toEqual(f.terminal)
  const staged = createLabelRevision(f.terminal, { provenance: { ...f.base.provenance, rerun: { attempt: 3 } } }, 'unfinished')
  f.append(staged)
  expect(api.readCommittedCorpus(f.root).snapshot.labelsById.get(f.base.cassetteId)).toEqual(f.terminal)
})
it('refuses the whole marker with missing ancestry and suppresses embedded fallback', () => {
  const f = setup()
  f.append(f.terminal)
  write(f.root, 'labels/calibration.json', f.artifact)
  expect(reader(f.root)?.kind).toBe('refused')
  expect(api.readCommittedCorpus(f.root).snapshot.entries).toEqual([])
})
it('never resurrects the base when every published revision file is missing', () => {
  const f = setup()
  write(f.root, 'labels/calibration.json', f.artifact)
  expect(reader(f.root)?.kind).toBe('refused')
  expect(api.readCommittedCorpus(f.root).snapshot.entries).toEqual([])
})
it('ignores an unlisted sibling even when it claims the published generation', () => {
  const f = setup()
  f.append(f.next); f.append(f.terminal)
  f.append(createLabelRevision(f.next, { provenance: { ...f.base.provenance, rerun: { attempt: 7 } } }, f.terminal.revision!.generationId))
  write(f.root, 'labels/calibration.json', f.artifact)
  expect(api.readCommittedCorpus(f.root).snapshot.labelsById.get(f.base.cassetteId)).toEqual(f.terminal)
})
it.each(['schema', 'prior', 'count', 'digest', 'target', 'interval', 'unknown'])('refuses malformed %s without echoing persisted content', mutation => {
  const f = setup()
  f.append(f.next); f.append(f.terminal)
  const artifact: any = structuredClone(f.artifact)
  if (mutation === 'schema') artifact.schemaVersion = 2
  if (mutation === 'prior') artifact.priors = { user: { alpha: -1, beta: 2 } }
  if (mutation === 'count') artifact.channels['user-mark'].n_gold = -1
  if (mutation === 'digest') artifact.evidenceDigest = 'unsafe persisted content'
  if (mutation === 'target') artifact.targetRevisions.push(artifact.targetRevisions[0])
  if (mutation === 'interval') artifact.channels['recorded-verdict'] = { status: 'calibrated', n: 20, n_gold: 20, precision: 0.5, wilson95: { low: 0.9, high: 0.1 } }
  if (mutation === 'unknown') artifact.secret = 'unsafe persisted content'
  const { generationId: _generation, ...body } = artifact
  artifact.generationId = sha256hex(canonicalJson(body))
  write(f.root, 'labels/calibration.json', artifact)
  expect(reader(f.root)).toMatchObject({ kind: 'refused', reason: expect.any(String) })
  expect(JSON.stringify(reader(f.root))).not.toContain('unsafe persisted content')
})
it('refuses symlinked marker and revision paths', () => {
  const f = setup()
  f.append(f.next)
  const revision = f.append(f.terminal)
  const outside = write(f.root, 'outside.json', f.terminal)
  rmSync(revision); symlinkSync(outside, revision)
  write(f.root, 'labels/calibration.json', f.artifact)
  expect(reader(f.root)?.kind).toBe('refused')
  rmSync(join(f.root, 'labels/calibration.json'))
  symlinkSync(write(f.root, 'marker.json', f.artifact), join(f.root, 'labels/calibration.json'))
  expect(reader(f.root)?.kind).toBe('refused')
})
