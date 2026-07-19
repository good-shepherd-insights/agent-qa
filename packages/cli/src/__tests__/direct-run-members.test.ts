import { describe, expect, it } from 'vitest'

import {
  parseTestFile,
  type ParsedTestBinding,
} from '@vostride/agent-qa-core'
import { projectRunOutcomes } from '@vostride/agent-qa-knowledge-local'
import {
  asRunId,
  type CompletedRunHandoff,
} from '@vostride/agent-qa-schema'

import { buildDirectRunMembers } from '../commands/direct-run-members.js'

const FILE_A = '/workspace/tests/account.yaml'
const FILE_B = '/workspace/tests/checkout.yaml'
const LOGIN_ID = 't_brick-cinder-dawn-echo-forest-grove-harvest-isle-jade-kite'
const CHECKOUT_ID = 't_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'

const FILE_A_CONTENT = [
  `test-id: ${LOGIN_ID}`,
  'name: login works',
  'target: storefront',
  'steps:',
  '  - Log in',
  '---',
  `test-id: ${CHECKOUT_ID}`,
  'name: checkout succeeds',
  'target: storefront',
  'steps:',
  '  - Complete checkout from the account page',
  '',
].join('\n')

const FILE_B_CONTENT = [
  `test-id: ${CHECKOUT_ID}`,
  'name: checkout succeeds',
  'target: storefront',
  'steps:',
  '  - Complete checkout from the cart page',
  '',
].join('\n')

function parseBindings(filePath: string, fileContent: string): ParsedTestBinding[] {
  const result = parseTestFile(fileContent, filePath)
  expect(result.errors).toEqual([])
  return result.tests.map((test) => ({ test, filePath, fileContent }))
}

function fixtureBindings(): ParsedTestBinding[] {
  return [
    ...parseBindings(FILE_A, FILE_A_CONTENT),
    ...parseBindings(FILE_B, FILE_B_CONTENT),
  ]
}

describe('buildDirectRunMembers', () => {
  it('keeps each member and digest bound to its parsed source file', () => {
    const result = buildDirectRunMembers(fixtureBindings())

    expect(result.members.map(({ filePath }) => filePath)).toEqual([
      FILE_A,
      FILE_A,
      FILE_B,
    ])
    expect(result.members.map(({ testIndex }) => testIndex)).toEqual([0, 1, 2])
    expect(result.members.map(({ name }) => name)).toEqual([
      'login works',
      'checkout succeeds',
      'checkout succeeds',
    ])
    expect(result.digestMembers).toEqual([
      { testFileContent: FILE_A_CONTENT },
      { testFileContent: FILE_A_CONTENT },
      { testFileContent: FILE_B_CONTENT },
    ])
  })

  it('projects equal-named tests from different files as distinct outcome rows', () => {
    const { members } = buildDirectRunMembers(fixtureBindings())
    const checkoutMembers = members.filter(({ name }) => name === 'checkout succeeds')
    const handoff: CompletedRunHandoff = {
      schemaVersion: 3,
      runId: asRunId('run-direct-bindings'),
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      aggregateVerdict: 'passed',
      configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
      startedAt: 1_750_000_000_000,
      endedAt: 1_750_000_001_000,
      tests: checkoutMembers.map((member, testIndex) => ({
        testId: member.testId,
        testName: member.name,
        filePath: member.filePath,
        testIndex,
        outcome: 'passed',
        steps: [],
      })),
    }

    const projection = projectRunOutcomes(handoff, {
      extractAnchors: () => [],
    })

    expect(projection.tests).toEqual([
      expect.objectContaining({ filePath: FILE_A, testName: 'checkout succeeds' }),
      expect.objectContaining({ filePath: FILE_B, testName: 'checkout succeeds' }),
    ])
  })
})
