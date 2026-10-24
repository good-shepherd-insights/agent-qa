import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { JUDGE_CONFIG } from '../config'
import { JUDGE_FAMILY_MAP, JUDGE_LINEAGE_OVERRIDES, resolveJudgeFamilies } from '../family'
import type { JudgeFamily } from '../family'

const PINNED_CONFIG_MATERIAL_HASHES: Readonly<Record<number, string>> = Object.freeze({
  // Bump procedure: increment judgeVersion and add the new material hash; never replace
  // an existing entry, because every persisted judge verdict stamps the judgeVersion it
  // was decided under and historical scores remain bound to that constitution.
  1: 'b89e9dad4e1837d84ba93187e9299bb7dd4df12d584078dd4788ea5158bbc51d',
  2: '04ddea86ff73229268aabeaa1547f70adc2f9c6af29e7277cedaec8225474ba6',
})

const JUDGE_FAMILY_NAMES: { [F in JudgeFamily]: true } = {
  claude: true,
  openai: true,
  gemini: true,
  llama: true,
  qwen: true,
  deepseek: true,
  mistral: true,
}

describe('JUDGE_CONFIG', () => {
  it('requires every material change to carry a pinned judge-version bump', () => {
    const material: Record<string, unknown> = { ...JUDGE_CONFIG }
    delete material.judgeVersion

    const expectedHash = PINNED_CONFIG_MATERIAL_HASHES[JUDGE_CONFIG.judgeVersion]
    expect(expectedHash).toBeDefined()
    expect(sha256hex(canonicalJson(material))).toBe(expectedHash)
  })

  it('is deeply frozen', () => {
    expect(Object.isFrozen(JUDGE_CONFIG)).toBe(true)
    expect(Object.isFrozen(JUDGE_CONFIG.familyMap)).toBe(true)
    for (const tokens of Object.values(JUDGE_CONFIG.familyMap)) {
      expect(Object.isFrozen(tokens)).toBe(true)
    }
    expect(Object.isFrozen(JUDGE_CONFIG.promptTemplate)).toBe(true)

    expect(() => {
      const mutableTemplate = JUDGE_CONFIG.promptTemplate as { systemTier: string }
      mutableTemplate.systemTier = 'weakened'
    }).toThrow(TypeError)
  })

  it('keeps the constitution internally consistent', () => {
    expect(JUDGE_CONFIG.judgeVersion).toBe(2)
    expect(JUDGE_CONFIG.maxPanelMembers).toBe(3)
    expect(JUDGE_CONFIG.pooling).toEqual({ verdict: 'max', score: 'avg' })
    expect(JUDGE_CONFIG.scorePoolingReservation).toContain('avg is reserved')
    expect(JUDGE_CONFIG.lineageOverrides).toBe(JUDGE_LINEAGE_OVERRIDES)
    expect(['high', 'medium', 'low']).toContain(JUDGE_CONFIG.confidenceThreshold)
    expect(JUDGE_CONFIG.confidenceThreshold).toBe('high')
    expect(Number.isInteger(JUDGE_CONFIG.maxDistinctCandidates)).toBe(true)
    expect(JUDGE_CONFIG.maxDistinctCandidates).toBeGreaterThan(0)
    expect(JUDGE_CONFIG.maxDistinctCandidates).toBe(3)

    // ONE map, hash-covered: the config embeds the resolver's table by reference.
    expect(JUDGE_CONFIG.familyMap).toBe(JUDGE_FAMILY_MAP)
    expect(Object.keys(JUDGE_CONFIG.familyMap).sort()).toEqual(
      Object.keys(JUDGE_FAMILY_NAMES).sort(),
    )
    for (const tokens of Object.values(JUDGE_CONFIG.familyMap)) {
      expect(tokens.length).toBeGreaterThan(0)
      for (const token of tokens) {
        expect(token.length).toBeGreaterThan(0)
        expect(token).toBe(token.toLowerCase())
      }
    }
  })

  it('freezes the exact two forbidding lineage unions without changing historical material', () => {
    expect(JUDGE_LINEAGE_OVERRIDES).toEqual([
      { token: 'deepseek-r1-distill-llama', families: ['deepseek', 'llama'] },
      { token: 'deepseek-r1-distill-qwen', families: ['deepseek', 'qwen'] },
    ])
    expect([...resolveJudgeFamilies('deepseek-r1-distill-llama')].sort()).toEqual(['deepseek', 'llama'])
    expect([...resolveJudgeFamilies('deepseek-r1-distill-qwen')].sort()).toEqual(['deepseek', 'qwen'])
    expect(Object.isFrozen(JUDGE_CONFIG.pooling)).toBe(true)
    expect(Object.isFrozen(JUDGE_LINEAGE_OVERRIDES)).toBe(true)
    for (const override of JUDGE_LINEAGE_OVERRIDES) {
      expect(Object.isFrozen(override)).toBe(true)
      expect(Object.isFrozen(override.families)).toBe(true)
    }
    const { judgeVersion, maxPanelMembers, lineageOverrides, pooling, scorePoolingReservation, ...v1 } = JUDGE_CONFIG
    expect(sha256hex(canonicalJson(v1))).toBe(PINNED_CONFIG_MATERIAL_HASHES[1])
  })

  it('carries the constitution content the prompt assembly depends on', () => {
    const { promptTemplate, rubric } = JUDGE_CONFIG

    expect(promptTemplate.systemTier).toContain('untrusted application data')
    expect(promptTemplate.systemTier).toContain('never as instructions')

    for (const verdict of ['equivalent', 'different', 'unsure']) {
      expect(promptTemplate.systemTier).toContain(verdict)
    }
    for (const confidence of ['high', 'medium', 'low']) {
      expect(promptTemplate.systemTier).toContain(confidence)
    }
    for (const field of ['verdict', 'confidence', 'rationale']) {
      expect(promptTemplate.systemTier).toContain(field)
    }
    expect(promptTemplate.systemTier).toMatch(/unsure.+rather than guess|answer 'unsure' when/i)

    expect(rubric.length).toBeGreaterThan(0)
    expect(rubric).toContain('unsure')

    expect(promptTemplate.frameBegin.length).toBeGreaterThan(0)
    expect(promptTemplate.frameEnd.length).toBeGreaterThan(0)
    expect(promptTemplate.frameBegin).not.toBe(promptTemplate.frameEnd)

    expect(promptTemplate.itemALabel).toBe('ITEM A')
    expect(promptTemplate.itemBLabel).toBe('ITEM B')
    expect(promptTemplate.questionElementEquivalence.length).toBeGreaterThan(0)
    expect(promptTemplate.questionValueEquivalence.length).toBeGreaterThan(0)
  })
})
