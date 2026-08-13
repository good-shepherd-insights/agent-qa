// The config-mutation vocabulary's acceptance bar (Phase 395-02, D-02 / D-03 / D-10 / D-11).
//
// WHAT MAKES EACH CELL RED, stated per cell rather than claimed for the file:
//
//   the strictness census   — any of these schemas minted without `.strict()`. These inputs are
//                             filled by a language model, so an unrecognised key is either a
//                             hallucinated field the op silently ignores or a value smuggled past
//                             the shape the guard reasons about.
//   the refs-only keyset    — a field capable of carrying a credential value added to
//                             `ConfigAuthSetInputSchema` (D-11's law expressed as a shape). The
//                             name predicate is proven able to FIRE by a control keyset below, so
//                             the passing assertion is not a `not.toContain` over a channel that
//                             never carried the marker.
//   the blocked-arm cells   — a blocked payload minted with a diff or content field, or minted
//                             without `.strict()` so one could be smuggled in beside the report.
//                             D-10 is that the persisted blocked record stores the REPORT and never
//                             the secret-bearing payload, and it is structural here.
//   the reason-vocabulary   — `crossBoundaryReasons` widened back to `string`. A classifier could
//                             then invent a fifth class that reads fine in an inbox and matches
//                             nothing on the grant machinery's enforcement side.
//   the round-trip cell     — a producer/record disagreement about field names or encodings. The
//                             payload is PRODUCED through `renderConfigDiff` and `base64Encode`,
//                             never written as a literal, so a shape that no producer can fill is
//                             not something this cell can be satisfied by.
//   the subtree matcher     — a matcher that compared paths exactly (the `workspace.envFile`-child
//                             case reds) or that ignored the `*` segment (the target case reds).

import { describe, expect, it } from 'vitest'

import {
  CONFIG_HOOK_RUNTIMES,
  ConfigApplyCommitSchema,
  ConfigApplyOutcomeSchema,
  ConfigApplyReceiptsSchema,
  ConfigAuthSetInputSchema,
  ConfigFieldSetInputSchema,
  ConfigHookAddInputSchema,
  ConfigProjectScaffoldInputSchema,
  ConfigProposalApplyInputSchema,
  ConfigTargetCreateInputSchema,
  ConfigTargetEditInputSchema,
  ConfigUndoProposeInputSchema,
} from '../actions'
import { base64Encode } from '../base64'
import {
  CROSS_BOUNDARY_REASONS,
  SECRET_ADJACENT_CONFIG_FIELDS,
  isSecretAdjacentConfigField,
} from '../constants'
import { renderConfigDiff } from '../diff-digest'
import {
  CONFIG_BLOCKED_REASONS,
  CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  ConfigProposalApplyableV1Schema,
  ConfigProposalBlockedV1Schema,
  ConfigProposalV1Schema,
} from '../proposal'
import { utf8Encode } from '../utf8'

/**
 * Every object schema this phase mints, with one value that parses.
 *
 * A CENSUS RATHER THAN A CELL PER SCHEMA, because the claim is about the SET: a schema added to
 * this vocabulary later and left non-strict is exactly the omission this table exists to make
 * visible, and it can only do that if adding a schema means adding a row.
 */
const STRICT_SCHEMAS = [
  ['ConfigTargetCreateInputSchema', ConfigTargetCreateInputSchema,
    { name: 'shop', platform: 'web', url: 'https://example.com' }],
  ['ConfigTargetEditInputSchema', ConfigTargetEditInputSchema,
    { name: 'shop', changes: { url: 'https://example.com' } }],
  ['ConfigAuthSetInputSchema', ConfigAuthSetInputSchema, { target: 'shop' }],
  ['ConfigHookAddInputSchema', ConfigHookAddInputSchema,
    { name: 'seed', runtime: 'node', file: 'scripts/seed.mjs' }],
  ['ConfigFieldSetInputSchema', ConfigFieldSetInputSchema, { path: 'use.parallel', value: true }],
  ['ConfigProjectScaffoldInputSchema', ConfigProjectScaffoldInputSchema, { domain: 'booking.com' }],
  ['ConfigUndoProposeInputSchema', ConfigUndoProposeInputSchema, {}],
  ['ConfigProposalApplyInputSchema', ConfigProposalApplyInputSchema, { proposalId: 'p_1' }],
  ['ConfigApplyCommitSchema', ConfigApplyCommitSchema, { role: 'agent', hash: 'abc1234' }],
  ['ConfigApplyReceiptsSchema', ConfigApplyReceiptsSchema,
    { commits: [{ role: 'agent', hash: 'abc1234' }], files: ['agent-qa.config.yaml'] }],
] as const

describe('the seven action inputs and the apply receipts', () => {
  it('parses every listed value — the census is not passing because nothing parses', () => {
    for (const [name, schema, value] of STRICT_SCHEMAS) {
      expect({ name, ok: schema.safeParse(value).success }).toEqual({ name, ok: true })
    }
  })

  it('refuses an unrecognised key on every one of them', () => {
    for (const [name, schema, value] of STRICT_SCHEMAS) {
      const smuggled = schema.safeParse({ ...value, unexpectedKey: 'anything' })
      expect({ name, refused: !smuggled.success }).toEqual({ name, refused: true })
    }
  })

  it('covers every action in the closed class — one input per op id', () => {
    expect(STRICT_SCHEMAS.map(([name]) => name)).toEqual([
      'ConfigTargetCreateInputSchema',
      'ConfigTargetEditInputSchema',
      'ConfigAuthSetInputSchema',
      'ConfigHookAddInputSchema',
      'ConfigFieldSetInputSchema',
      'ConfigProjectScaffoldInputSchema',
      'ConfigUndoProposeInputSchema',
      'ConfigProposalApplyInputSchema',
      'ConfigApplyCommitSchema',
      'ConfigApplyReceiptsSchema',
    ])
  })

  it('the hook runtimes are the four the hooks file already admits', () => {
    expect([...CONFIG_HOOK_RUNTIMES]).toEqual(['node', 'bun', 'python', 'bash'])
    expect(ConfigHookAddInputSchema.safeParse({
      name: 'seed', runtime: 'deno', file: 'scripts/seed.ts',
    }).success).toBe(false)
  })

  it('the undo input takes nothing at all — the reverse diff is computed host-side (D-07)', () => {
    expect(Object.keys(ConfigUndoProposeInputSchema.shape)).toEqual([])
    expect(ConfigUndoProposeInputSchema.safeParse({ commit: 'HEAD~1' }).success).toBe(false)
  })

  it('the scaffold input carries the domain and nothing a model could invent (D-13)', () => {
    expect(Object.keys(ConfigProjectScaffoldInputSchema.shape)).toEqual(['domain'])
  })

  it('both apply outcome arms carry the SAME receipt shape', () => {
    const receipts = { commits: [{ role: 'agent', hash: 'abc1234' }], files: ['agent-qa.config.yaml'] }
    for (const outcome of ['applied', 'already-applied'] as const) {
      expect(ConfigApplyOutcomeSchema.safeParse({ ...receipts, outcome }).success).toBe(true)
      expect(ConfigApplyOutcomeSchema.safeParse({ ...receipts, outcome, extra: 1 }).success)
        .toBe(false)
    }
  })
})

/**
 * Does any of these field names look like somewhere a VALUE could be put?
 *
 * The predicate is deliberately broad — it is looking for the shape of a mistake, not for a known
 * bad name — and its ability to fire is proven below before it is trusted to pass.
 */
function namesAValueBearingField(keys: readonly string[]): string[] {
  return keys.filter((key) => /secret|password|token|credential|apikey|value|\bkey$/i.test(key))
}

describe('set_auth is refs-only by shape, not by discipline (D-11)', () => {
  const keys = Object.keys(ConfigAuthSetInputSchema.shape)

  it('the predicate can fire — a control keyset carrying a credential field is caught', () => {
    expect(namesAValueBearingField(['target', 'password'])).toEqual(['password'])
    expect(namesAValueBearingField(['target', 'apiKey'])).toEqual(['apiKey'])
    expect(namesAValueBearingField(['target', 'authStateSecret'])).toEqual(['authStateSecret'])
  })

  it('the keyset is exactly the four references, in the order the shape declares them', () => {
    expect(keys).toEqual(['target', 'authStateName', 'pluginPackage', 'envVarName'])
  })

  it('no field of it could carry a credential value', () => {
    expect(namesAValueBearingField(keys)).toEqual([])
  })

  it('a credential handed to it under any name is refused by strictness', () => {
    for (const smuggled of ['password', 'token', 'apiKey', 'authStateValue']) {
      expect(ConfigAuthSetInputSchema.safeParse({ target: 'shop', [smuggled]: 'hunter2' }).success)
        .toBe(false)
    }
  })
})

describe('the blocked arm cannot carry the payload it blocked (D-10)', () => {
  const blocked = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'blocked' as const,
    action: 'config.field.set',
    summaryLine: 'set plugins.auth.0.package to an internal build',
    blockedReason: 'guardrail-hit' as const,
    paths: ['agent-qa.config.yaml'],
    scanFindings: [{
      path: 'agent-qa.config.yaml',
      field: 'registry.providers.farm.accessKey',
      detector: 'known-secret',
      redactedFingerprint: 'sha256:9f86…0a08',
    }],
  }

  it('parses as a config payload, and narrows to the blocked arm', () => {
    const parsed = ConfigProposalV1Schema.parse(blocked)
    expect(parsed.payloadKind).toBe('blocked')
  })

  it('refuses a payload carrying the rendered diff bytes', () => {
    expect(ConfigProposalBlockedV1Schema.safeParse({
      ...blocked,
      shownDiffBase64: base64Encode(utf8Encode('--- a/agent-qa.config.yaml\n')),
    }).success).toBe(false)
    expect(ConfigProposalBlockedV1Schema.safeParse({
      ...blocked,
      shownDiffDigest: 'deadbeef',
    }).success).toBe(false)
  })

  it('refuses a payload carrying file content', () => {
    expect(ConfigProposalBlockedV1Schema.safeParse({
      ...blocked,
      newContentBase64: base64Encode(utf8Encode('use:\n  parallel: true\n')),
    }).success).toBe(false)
    expect(ConfigProposalBlockedV1Schema.safeParse({
      ...blocked,
      files: [{ path: 'agent-qa.config.yaml', changeKind: 'modify', newContentBase64: '' }],
    }).success).toBe(false)
  })

  it('has no diff or content field in its declared shape at all', () => {
    const shape = Object.keys(ConfigProposalBlockedV1Schema.shape)
    expect(shape.filter((key) => /diff|content|bytes|base64/i.test(key))).toEqual([])
    expect(shape).toEqual([
      'schemaVersion',
      'payloadKind',
      'action',
      'summaryLine',
      'blockedReason',
      'paths',
      'scanFindings',
      'validationIssues',
    ])
  })

  it('names one posture and two reasons (CFGM-01)', () => {
    expect([...CONFIG_BLOCKED_REASONS]).toEqual(['schema-fail', 'guardrail-hit'])
    expect(ConfigProposalBlockedV1Schema.safeParse({ ...blocked, blockedReason: 'other' }).success)
      .toBe(false)
  })

  it('a schema-fail carries validation issues and no scan findings', () => {
    const { scanFindings: _dropped, ...withoutFindings } = blocked
    expect(ConfigProposalBlockedV1Schema.safeParse({
      ...withoutFindings,
      blockedReason: 'schema-fail',
      validationIssues: ['use.parallel: expected boolean, received string'],
    }).success).toBe(true)
  })
})

describe('a produced applyable payload round-trips through its own schema', () => {
  // PRODUCED, NEVER A LITERAL. Every byte-bearing field below comes out of the real primitive and
  // the real codec, so a shape no producer can fill cannot satisfy this cell.
  const oldBytes = utf8Encode('use:\n  parallel: false\n')
  const newBytes = utf8Encode('use:\n  parallel: true\n')
  const rendered = renderConfigDiff([{ path: 'agent-qa.config.yaml', oldBytes, newBytes }])
  if (rendered.outcome !== 'changed') throw new TypeError('the corpus produced no change')
  const digests = rendered.perFileDigests[0]!

  const payload = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'applyable' as const,
    action: 'config.field.set',
    summaryLine: 'set use.parallel to true',
    files: [{
      path: 'agent-qa.config.yaml',
      changeKind: 'modify' as const,
      baseDigest: digests.oldDigest!,
      newContentBase64: base64Encode(newBytes),
    }],
    shownDiffBase64: base64Encode(rendered.diffBytes),
    shownDiffDigest: rendered.diffDigest,
    crossBoundary: false,
    crossBoundaryReasons: [],
  }

  it('parses, and parsing changes nothing about it', () => {
    expect(ConfigProposalApplyableV1Schema.parse(payload)).toEqual(payload)
  })

  it('narrows to the applyable arm through the union', () => {
    const parsed = ConfigProposalV1Schema.parse(payload)
    expect(parsed.payloadKind).toBe('applyable')
  })
})

describe('the cross-boundary reason vocabulary is closed (D-02)', () => {
  it('bounds exactly the four classes D-02 names', () => {
    expect([...CROSS_BOUNDARY_REASONS])
      .toEqual(['secret-adjacent-field', 'new-origin', 'hook-added', 'out-of-set-path'])
  })

  it('the payload accepts every member of it', () => {
    const base = {
      schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
      payloadKind: 'applyable' as const,
      action: 'config.target.create',
      summaryLine: 'add target shop',
      files: [{ path: 'agent-qa.config.yaml', changeKind: 'modify' as const, newContentBase64: '' }],
      shownDiffBase64: 'eA==',
      shownDiffDigest: 'abc',
      crossBoundary: true,
    }
    expect(ConfigProposalApplyableV1Schema.safeParse({
      ...base,
      crossBoundaryReasons: [...CROSS_BOUNDARY_REASONS],
    }).success).toBe(true)
  })

  it('refuses a reason nobody can enforce on', () => {
    expect(ConfigProposalApplyableV1Schema.safeParse({
      schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
      payloadKind: 'applyable',
      action: 'config.target.create',
      summaryLine: 'add target shop',
      files: [{ path: 'agent-qa.config.yaml', changeKind: 'modify', newContentBase64: '' }],
      shownDiffBase64: 'eA==',
      shownDiffDigest: 'abc',
      crossBoundary: true,
      crossBoundaryReasons: ['feels-risky'],
    }).success).toBe(false)
  })
})

describe('the secret-adjacent field set is roots, and matching is by subtree (D-03)', () => {
  it('names the seven roots', () => {
    expect([...SECRET_ADJACENT_CONFIG_FIELDS]).toEqual([
      'workspace.envFile',
      'workspace.secretsFile',
      'services.authState',
      'plugins.auth',
      'plugins.providers',
      'registry.providers',
      'registry.targets.*.authState',
    ])
  })

  it('flags each root exactly', () => {
    for (const root of SECRET_ADJACENT_CONFIG_FIELDS) {
      const concrete = root.replace('*', 'shop')
      expect({ root, flagged: isSecretAdjacentConfigField(concrete) })
        .toEqual({ root, flagged: true })
    }
  })

  it('flags anything UNDER a root, whether or not anybody enumerated it', () => {
    for (const path of [
      'services.authState.dir',
      'plugins.auth.0.package',
      'plugins.providers.0.path',
      'registry.providers.farm.accessKey',
      'registry.targets.shop.authState.name',
    ]) {
      expect({ path, flagged: isSecretAdjacentConfigField(path) }).toEqual({ path, flagged: true })
    }
  })

  it('flags an edit ABOVE a root too — setting it replaces the subtree', () => {
    for (const path of [
      'plugins',
      'workspace',
      'services',
      'registry.targets.shop',
      'registry.targets',
    ]) {
      expect({ path, flagged: isSecretAdjacentConfigField(path) }).toEqual({ path, flagged: true })
    }
  })

  it('does not flag the ordinary config a person edits all day', () => {
    for (const path of [
      'use.parallel',
      'use.timeout.step',
      'workspace.testMatch',
      'workspace.hooksFile',
      'registry.targets.shop.url',
      'services.dashboard.port',
      'registry.llms',
      'knowledge.dir',
    ]) {
      expect({ path, flagged: isSecretAdjacentConfigField(path) }).toEqual({ path, flagged: false })
    }
  })

  it('the wildcard matches one segment, never a prefix of a longer name', () => {
    expect(isSecretAdjacentConfigField('registry.targetsOther.shop.authState')).toBe(false)
    expect(isSecretAdjacentConfigField('workspace.envFileBackup')).toBe(false)
  })
})
