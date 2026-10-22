import { describe, expect, it } from 'vitest'

import { VersionGuardError } from '../../versioning/create-version-guard'
import {
  guardArtifactsIndex,
  guardBundleManifest,
  guardBundleProvenance,
  guardBundleRelations,
} from '../bundle-files'
import {
  parseProcedureBody,
  serializeProcedureBody,
  type ProcedureBodyPayload,
} from '../procedure-steps'
import { emitRecordMarkdown, parseRecordMarkdown, type RecordFrontmatter } from '../record-frontmatter'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const DIGEST_C = 'c'.repeat(64)

const manifest = {
  schemaVersion: 2,
  id: 'fact-el-sign-in-button-0123456789abcdef',
  identityHash: DIGEST_A,
  identityCore: {
    kind: 'fact' as const,
    subtype: 'selector' as const,
    primaryAnchor: { t: 'el' as const, role: 'button', name: 'sign in' },
    scope: { tier: 'product' as const, key: 'storefront' },
    discriminantKey: '{"kind":"fact"}',
  },
  embeddingInput: 'Sign-in button',
  contentHashes: { 'record.md': DIGEST_B },
  mutableStateHash: DIGEST_C,
  evidenceIncomplete: false,
  complete: true,
  createdAtOrdinal: 1,
  originClass: 'agent-verified' as const,
}

const provenance = {
  schemaVersion: 2,
  mode: 'standalone' as const,
  originClass: 'user' as const,
  sourceDescription: 'authored by hand',
}

const relations = { schemaVersion: 2, relations: [] }

const artifactsIndex = {
  schemaVersion: 2,
  artifacts: [{
    id: 'screenshot-a',
    sha: DIGEST_A,
    bytes: 8,
    stepIndex: 0,
    relPath: `artifacts/${DIGEST_A}`,
  }],
}

const bundleFiles = [
  ['BundleManifest', guardBundleManifest, manifest],
  ['BundleProvenance', guardBundleProvenance, provenance],
  ['BundleRelations', guardBundleRelations, relations],
  ['ArtifactsIndex', guardArtifactsIndex, artifactsIndex],
] as const

const frontmatter: RecordFrontmatter = {
  schemaVersion: 2,
  id: 'fact-el-sign-in-button-0123456789abcdef',
  kind: 'fact',
  subtype: 'selector',
  anchors: [{
    raw: { t: 'el', role: 'Button', name: 'Sign in' },
    normalized: { t: 'el', role: 'button', name: 'sign in' },
  }],
  scope: { tier: 'product', key: 'storefront' },
  createdAtOrdinal: 1,
  originClass: 'agent-verified',
  evidenceIncomplete: false,
}

const recordBody = { summary: 'Sign-in button', body: 'Clicking submits credentials.' }

function recordStamped(stamp: number): string {
  return emitRecordMarkdown(frontmatter, recordBody).replace(
    '\nschemaVersion: 2\n',
    `\nschemaVersion: ${stamp}\n`,
  )
}

const procedureBody: ProcedureBodyPayload = {
  schemaVersion: 2,
  parameters: [{ name: 'email', type: 'string', required: true }],
  steps: [{
    instruction: 'Fill the email field',
    action: {
      type: 'fill',
      targets: { ref: { role: 'textbox', nameNormalized: 'email' } },
      values: { text: { param: 'email' } },
    },
    guard: {
      target: { role: 'textbox', nameNormalized: 'email' },
      pageAnchor: { t: 'page', route: '/sign-in' },
    },
  }],
  successAssertion: 'The email field holds the address',
}

function procedureBodyStamped(stamp: number): string {
  const planted = { ...procedureBody, schemaVersion: stamp }
  return serializeProcedureBody(planted as unknown as ProcedureBodyPayload)
}

describe('committed knowledge stamps', () => {
  it.each(bundleFiles)('reads a %s stamped 2', (_name, guard, document) => {
    expect(guard(document)).toEqual(document)
  })

  describe.each(bundleFiles)('%s', (name, guard, document) => {
    it.each([1, 3])('refuses a document stamped %i', (stamp) => {
      expect(() => guard({ ...document, schemaVersion: stamp })).toThrowError(VersionGuardError)
      expect(() => guard({ ...document, schemaVersion: stamp })).toThrow(name)
    })
  })

  it('reads record frontmatter stamped 2', () => {
    expect(parseRecordMarkdown(recordStamped(2)).frontmatter).toEqual(frontmatter)
  })

  it.each([1, 3])('refuses record frontmatter stamped %i', (stamp) => {
    const markdown = recordStamped(stamp)
    expect(markdown).toContain(`\nschemaVersion: ${stamp}\n`)
    expect(() => parseRecordMarkdown(markdown)).toThrowError(VersionGuardError)
  })

  it('reads a procedure body stamped 2', () => {
    expect(parseProcedureBody(procedureBodyStamped(2))).toEqual(procedureBody)
  })

  it.each([1, 3])('refuses a procedure body stamped %i', (stamp) => {
    const body = procedureBodyStamped(stamp)
    expect(body).toContain(`"schemaVersion":${stamp}`)
    expect(parseProcedureBody(body)).toBeUndefined()
  })
})
