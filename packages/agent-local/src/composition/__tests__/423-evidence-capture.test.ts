import { expect, test, vi } from 'vitest'
import { createMemberEventSink, createRunEventBus, runMemberTest, SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import type { MemberRunConfig, PlatformAdapter } from '@vostride/agent-qa-runner'
import type { EvidenceDocument, StepFinalizedPayload } from '@vostride/agent-qa-schema'
import { buildMemberRunConfig, buildRunMaskingContext } from '../run-composition.js'

vi.mock('@vostride/agent-qa-web', () => ({ runAccessibilityCheck: vi.fn(async () => []) }))

function fixture() {
  const terminals: StepFinalizedPayload[] = []
  const documents: EvidenceDocument[] = []
  const bus = createRunEventBus({ runId: 'synthetic-composition-423' })
  bus.subscribe(1, event => {
    if (event.type === 'stepFinalized') terminals.push(event.payload as StepFinalizedPayload)
  })
  const masking = buildRunMaskingContext({ env: {} })
  const adapter: PlatformAdapter = {
    platform: 'web', setup: async () => {}, cleanup: async () => {},
    observe: async () => { throw new Error('No extra capture permitted') },
    execute: async () => ({ success: true }),
  }
  const input = {
    adapter, masking, planner: { plan: async () => { throw new Error('No model call permitted') } },
    plannerModel: {} as MemberRunConfig['plannerModel'], verifierModel: {} as MemberRunConfig['verifierModel'],
    sink: createMemberEventSink({ bus, masking, testIndex: 0 }),
    testIndex: 0, abortSignal: new AbortController().signal, filePath: 'synthetic.yaml',
    accessibility: { enabled: true },
    evidenceArtifacts: {
      persistDecisionScreenshot: () => ({ id: `decision-screenshot:${'a'.repeat(64)}`, sha: 'a'.repeat(64) }),
      getBlob: () => undefined,
      persistEvidenceDocument: (document: EvidenceDocument) => {
        documents.push(structuredClone(document))
        return { id: `${document.kind}-evidence:${'b'.repeat(64)}`, sha: 'b'.repeat(64) }
      },
    },
  }
  const member = { testId: 'synthetic-member-423', name: 'Synthetic capture', filePath: input.filePath,
    steps: ['{{appium: mobile: hideKeyboard}}'] }
  return { input, member, terminals, documents, adapter }
}

test.each(['no-getter', 'non-callable', 'no-page', 'getter-throws', 'captured-zero'] as const)(
  'EVID-COMPOSED-CAPABILITY: %s reports actual availability through the member finalizer', async kind => {
    const f = fixture()
    if (kind === 'non-callable') Object.assign(f.adapter, { getPage: 'not callable' })
    if (kind === 'no-page') Object.assign(f.adapter, { getPage: () => undefined })
    if (kind === 'getter-throws') Object.assign(f.adapter, { getPage: () => { throw new Error('Synthetic lost page') } })
    if (kind === 'captured-zero') Object.assign(f.adapter, { getPage: () => ({}) })
    const result = await runMemberTest(f.member, buildMemberRunConfig(f.input))
    const reason = ['no-getter', 'non-callable'].includes(kind) ? 'unsupported'
      : kind === 'captured-zero' ? 'empty' : 'failed'
    expect(result.status).toBe('passed')
    expect(f.terminals).toHaveLength(1)
    expect(f.terminals[0].evidence?.a11y).toEqual({ kind: 'a11y', state: 'absent', reason })
    expect(f.documents).toEqual([])
  },
)

test('VARIABLE-MASK-NAMES-COMPOSED: sensitive env names seed the actual live mask used at finalization', async () => {
  const f = fixture()
  const ambient = 'synthetic-ambient-credential-423'
  const declared = 'synthetic-declared-credential-423'
  const late = 'synthetic-midrun-credential-423'
  const safeUrl = 'https://example.test/'
  const env = { SYNTHETIC_API_TOKEN: ambient, BASE_URL: safeUrl }
  const secretStore = new SecretStore({ declared })
  const masking = buildRunMaskingContext({ env, secretStore })
  const config = buildMemberRunConfig({ ...f.input, masking, envFileVars: env,
    inlineVars: { [`name-${ambient}`]: ambient, [`name-${late}`]: late, [declared]: declared },
    secretStore, secretRedactor: new SecretRedactor(secretStore),
  })
  f.adapter.execute = async () => { masking.register(late); return { success: true } }
  await runMemberTest(f.member, config)
  const snapshot = f.terminals[0].variableSnapshot
  expect(snapshot).toEqual({
    SYNTHETIC_API_TOKEN: { value: masking.mask(ambient), source: 'env' },
    BASE_URL: { value: safeUrl, source: 'env' },
    [`name-${masking.mask(ambient)}`]: { value: masking.mask(ambient), source: 'inline' },
    [`name-${masking.mask(late)}`]: { value: masking.mask(late), source: 'inline' },
    '[secret]': { value: '[secret]', source: 'inline' },
  })
  for (const value of [ambient, declared, late]) expect(JSON.stringify(snapshot)).not.toContain(value)
  expect(f.terminals[0].evidence?.variables).toEqual({ kind: 'variables', state: 'present', counts: { count: 5 } })
})
