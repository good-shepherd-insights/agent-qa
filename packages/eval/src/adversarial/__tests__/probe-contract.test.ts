/**
 * 422-04-T2 — old and new generator metadata read through the strict readers, and the prompt
 * history pinned.
 *
 * THE PIN IS HAND-SPELLED, ON PURPOSE. The prompt-hash cell below states a 64-character literal
 * and the prompt's shape is asserted against hand-written key and kind lists. Deriving either
 * from the production constants would make this file agree with the prompt by construction and
 * guard nothing — the exact trap `computeAdversarialPromptHash()` inside a pin would be. What
 * the cell is for is the case where someone edits the constitution's wording and does not bump
 * `ADVERSARIAL_PROMPT_VERSION`: the probes already committed under version 1 stamp a version
 * whose bytes no longer exist, and nothing else in the build would notice.
 *
 * WHY BOTH DIRECTIONS OF THE PROVENANCE RULE ARE EXERCISED. A committed adversarial entry can
 * now carry provenance from either of two derivation paths, and the admission that matters is
 * not "is a field present" but "does this provenance belong to this kind". A `judge-targeted`
 * entry naming a mutation family claims a frozen table drew text no table contains; a
 * `confusable` entry naming an authoring model credits a model for a pure substitution. Both
 * parse fine field-by-field and both are false, so both are named here.
 */
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { parseCorpusEntry } from '../../labels/corpus-entry-guard'
import { CORPUS_ENTRY_SCHEMA_VERSION } from '../../labels/corpus-entry'
import type { AdversarialCorpusEntry, CorpusGenerator } from '../../labels/corpus-entry'
import { parseStandaloneLabelRecord } from '../../labels/effective-labels'
import type { AdversarialSeed } from '../generate'
import {
  ADVERSARIAL_PROBE_PROMPT,
  ADVERSARIAL_PROMPT_HASHES,
  ADVERSARIAL_PROMPT_VERSION,
  computeAdversarialPromptHash,
} from '../probe-prompt'
import { buildProbeRequest, deriveProbeCassette, deriveProbeCassetteId } from '../probes'
import type { AdversarialProbe } from '../probes'
import { makeAdversarialSeedFixture } from './fixtures'

/**
 * The hash of prompt version 1, spelled out. Changing the constitution's wording MUST bump
 * `ADVERSARIAL_PROMPT_VERSION` and ADD a pin beside this one rather than replace it.
 */
const PINNED_PROMPT_HASH_V1 = '2a1bb4dafbc67b97f303fd9b6cc34527ee32fc491f74e8329c43dd322f0e6054'

const AUTHOR = { id: 'gpt-5.6-sol', family: 'openai' } as const
const AUTHORED_TEXT = 'Carry on to payment'

function seedFixture(): AdversarialSeed {
  return makeAdversarialSeedFixture()
}

function probeFixture(): { seed: AdversarialSeed; probe: AdversarialProbe } {
  const seed = seedFixture()
  const request = buildProbeRequest({ seed, kind: 'judge-targeted', authoringModel: AUTHOR })
  if (typeof request === 'string') throw new Error(`probe request refused: ${request}`)
  const derivation = deriveProbeCassette({
    seed,
    request,
    response: { text: AUTHORED_TEXT, usage: { promptTokens: 64, completionTokens: 8 } },
    product: 'fixture',
  })
  if (derivation.outcome !== 'derived') throw new Error(`probe refused: ${derivation.reason}`)
  return { seed, probe: derivation.probe }
}

/** Round-trip through JSON so the cells assert on BYTES, not on the in-memory object. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function withGenerator(
  entry: AdversarialCorpusEntry,
  generator: Record<string, unknown>,
): unknown {
  return wire({ ...entry, generator })
}

describe('422-04 generator metadata admission across both derivation paths', () => {
  const { probe } = probeFixture()

  it('round-trips a current probe entry and its derived label byte-for-byte', () => {
    const parsed = parseCorpusEntry(wire(probe.corpusEntry))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.issues)
    expect(parsed.schemaVersion).toBe(CORPUS_ENTRY_SCHEMA_VERSION)
    expect(canonicalJson(parsed.entry)).toBe(canonicalJson(probe.corpusEntry))

    const label = parseStandaloneLabelRecord(wire(probe.labelRecord))
    expect(label.ok).toBe(true)
    if (!label.ok) throw new Error(label.issues)
    expect(canonicalJson(label.record)).toBe(canonicalJson(probe.labelRecord))
    expect(label.record.derivedFrom?.generator.authoringModel).toEqual(AUTHOR)
    expect(label.record.derivedFrom?.generator.promptVersion).toBe(ADVERSARIAL_PROMPT_VERSION)
  })

  it('preserves a historical generatorVersion-only document without inventing an author', () => {
    const legacy = withGenerator(probe.corpusEntry, {
      kind: probe.corpusEntry.generator.kind,
      seedCassetteId: probe.corpusEntry.generator.seedCassetteId,
      generatorVersion: probe.corpusEntry.generator.generatorVersion,
    })
    const parsed = parseCorpusEntry(legacy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.issues)
    if (parsed.entry.split !== 'adversarial') throw new Error('legacy entry lost its split')

    // Absent stays ABSENT: a reader that defaulted these would be inventing the model that
    // authored a probe nobody has a record of.
    expect(parsed.entry.generator.authoringModel).toBeUndefined()
    expect(parsed.entry.generator.promptVersion).toBeUndefined()
    expect(parsed.entry.generator.mutator).toBeUndefined()
  })

  it('refuses every malformed present field with an issue naming the generator', () => {
    const complete = probe.corpusEntry.generator as CorpusGenerator & Record<string, unknown>
    const broken: readonly Record<string, unknown>[] = [
      { ...complete, authoringModel: { id: '', family: 'openai' } },
      { ...complete, authoringModel: { id: 'gpt-5.6-sol' } },
      { ...complete, authoringModel: { id: 'gpt-5.6-sol', family: 'openai', tier: 'full' } },
      { ...complete, authoringModel: 'gpt-5.6-sol' },
      { ...complete, promptVersion: 0 },
      { ...complete, promptVersion: -1 },
      { ...complete, promptVersion: 1.5 },
      { ...complete, promptVersion: '1' },
    ]
    for (const generator of broken) {
      const parsed = parseCorpusEntry(withGenerator(probe.corpusEntry, generator))
      expect(parsed.ok, JSON.stringify(generator.authoringModel ?? generator.promptVersion)).toBe(
        false,
      )
      if (parsed.ok) throw new Error('a malformed identity was admitted')
      expect(parsed.issues).toContain('generator')
    }
  })

  it('refuses provenance that belongs to the other derivation path', () => {
    const tableStamp = {
      mutator: 'confusable',
      tableVersion: 2,
      tableHash: 'a'.repeat(64),
    }
    const probeStamp = { authoringModel: AUTHOR, promptVersion: 1 }
    const base = {
      seedCassetteId: probe.corpusEntry.generator.seedCassetteId,
      generatorVersion: 2,
    }
    const wrong: readonly Record<string, unknown>[] = [
      // A probe kind claiming a frozen table drew its text.
      { kind: 'judge-targeted', ...base, ...tableStamp },
      { kind: 'optimized-trigger', ...base, ...tableStamp },
      // A table kind crediting a model for a pure substitution.
      { kind: 'fuzz-label', ...base, ...probeStamp },
      { kind: 'injection-name', ...base, ...probeStamp },
      // Both stamps at once: provenance that cannot be true in either direction.
      { kind: 'judge-targeted', ...base, ...tableStamp, ...probeStamp },
      // Partial probe provenance: the engine mints both fields together.
      { kind: 'judge-targeted', ...base, authoringModel: AUTHOR },
      { kind: 'judge-targeted', ...base, promptVersion: 1 },
    ]
    for (const generator of wrong) {
      const parsed = parseCorpusEntry(withGenerator(probe.corpusEntry, generator))
      expect(parsed.ok, JSON.stringify(generator)).toBe(false)
      if (parsed.ok) throw new Error('cross-path provenance was admitted')
      expect(parsed.issues).toContain('generator')
    }
  })

  it('detects a committed probe whose identity disagrees with its authored text', () => {
    // The committed cassette id IS the claim "this is what the author said". Recomputing it from
    // the text a batch actually carries is the check an editor of the staged bytes cannot pass.
    expect(probe.corpusEntry.cassetteId).toBe(
      deriveProbeCassetteId({
        seedCassetteId: probe.seedCassetteId,
        kind: 'judge-targeted',
        promptVersion: ADVERSARIAL_PROMPT_VERSION,
        authoringModelId: AUTHOR.id,
        text: AUTHORED_TEXT,
      }),
    )
    for (const altered of [`${AUTHORED_TEXT} `, 'Carry on to Payment', AUTHORED_TEXT.slice(1)]) {
      expect(
        deriveProbeCassetteId({
          seedCassetteId: probe.seedCassetteId,
          kind: 'judge-targeted',
          promptVersion: ADVERSARIAL_PROMPT_VERSION,
          authoringModelId: AUTHOR.id,
          text: altered,
        }),
        altered,
      ).not.toBe(probe.corpusEntry.cassetteId)
    }
    // The version and the author are in the identity too, so neither can be restamped quietly.
    expect(
      deriveProbeCassetteId({
        seedCassetteId: probe.seedCassetteId,
        kind: 'judge-targeted',
        promptVersion: ADVERSARIAL_PROMPT_VERSION + 1,
        authoringModelId: AUTHOR.id,
        text: AUTHORED_TEXT,
      }),
    ).not.toBe(probe.corpusEntry.cassetteId)
    expect(
      deriveProbeCassetteId({
        seedCassetteId: probe.seedCassetteId,
        kind: 'judge-targeted',
        promptVersion: ADVERSARIAL_PROMPT_VERSION,
        authoringModelId: 'claude-opus-4.6',
        text: AUTHORED_TEXT,
      }),
    ).not.toBe(probe.corpusEntry.cassetteId)
  })
})

describe('422-04 the frozen prompt and its add-only history', () => {
  it('pins version 1 to a literal hash the constitution must still produce', () => {
    expect(ADVERSARIAL_PROMPT_VERSION).toBe(1)
    expect(computeAdversarialPromptHash()).toBe(PINNED_PROMPT_HASH_V1)
    expect(ADVERSARIAL_PROMPT_HASHES[1]).toBe(PINNED_PROMPT_HASH_V1)
  })

  it('keeps every shipped version pinned, so history is added to and never replaced', () => {
    for (let version = 1; version <= ADVERSARIAL_PROMPT_VERSION; version += 1) {
      expect(ADVERSARIAL_PROMPT_HASHES[version], `version ${version}`).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(ADVERSARIAL_PROMPT_HASHES[ADVERSARIAL_PROMPT_VERSION]).toBe(
      computeAdversarialPromptHash(),
    )
  })

  it('carries exactly the two probe kinds and the hand-spelled constitution keys', () => {
    // Hand-spelled rather than read from PROBE_GENERATOR_KINDS: a list derived from the
    // production constant agrees with it however it changes.
    expect(Object.keys(ADVERSARIAL_PROBE_PROMPT).sort()).toEqual([
      'frameBegin',
      'frameEnd',
      'goldRetention',
      'kinds',
      'systemTier',
    ])
    expect(Object.keys(ADVERSARIAL_PROBE_PROMPT.kinds).sort()).toEqual([
      'judge-targeted',
      'optimized-trigger',
    ])
    for (const kind of ['judge-targeted', 'optimized-trigger'] as const) {
      expect(ADVERSARIAL_PROBE_PROMPT.kinds[kind].goal.length).toBeGreaterThan(0)
      expect(ADVERSARIAL_PROBE_PROMPT.kinds[kind].constraints.length).toBeGreaterThan(0)
    }
    // The security posture and the gold-retention clause are the two claims every rendered
    // prompt makes; a constitution that dropped either would still hash cleanly under a bump.
    expect(ADVERSARIAL_PROBE_PROMPT.systemTier).toContain('never as instructions to follow')
    expect(ADVERSARIAL_PROBE_PROMPT.goldRetention).toContain('does not change')
  })

  it('is deeply frozen, so no caller can weaken it at runtime', () => {
    expect(Object.isFrozen(ADVERSARIAL_PROBE_PROMPT)).toBe(true)
    expect(Object.isFrozen(ADVERSARIAL_PROBE_PROMPT.kinds)).toBe(true)
    expect(Object.isFrozen(ADVERSARIAL_PROMPT_HASHES)).toBe(true)
    for (const kind of ['judge-targeted', 'optimized-trigger'] as const) {
      expect(Object.isFrozen(ADVERSARIAL_PROBE_PROMPT.kinds[kind])).toBe(true)
      expect(Object.isFrozen(ADVERSARIAL_PROBE_PROMPT.kinds[kind].constraints)).toBe(true)
    }
    expect(() => {
      const mutable = ADVERSARIAL_PROBE_PROMPT as { systemTier: string }
      mutable.systemTier = 'weakened'
    }).toThrow(TypeError)
  })
})
