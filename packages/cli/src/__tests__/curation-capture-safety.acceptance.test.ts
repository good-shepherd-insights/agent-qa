import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  drainQueue,
  enumerateBundleDirs,
  loadBundle,
  queuedCandidateDir,
  queueRoot,
  verifyBundleIntegrity,
  type CurationCandidatePayload,
  type CuratorAuthor,
} from '@vostride/agent-qa-knowledge-local'
import {
  asRef,
  asRunId,
  type CompletedRunHandoff,
  type ElementInfo,
  type ScreenState,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it } from 'vitest'

import { emitCurationCandidates } from '../curation/emit-candidates.js'

const FIXTURE_CREDENTIAL = 'safe-02-fixture-credential-378-27'
const REDACTION_PLACEHOLDER = '<REDACTED:capture-blacklist>'

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function hasOwnPropertyDeep(value: unknown, property: string): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (Object.prototype.hasOwnProperty.call(value, property)) return true
  return Object.values(value).some((child) => hasOwnPropertyDeep(child, property))
}

function passwordElement(): ElementInfo {
  return {
    ref: asRef('password-field'),
    role: 'textbox',
    name: 'Account password',
    nameNormalized: 'account password',
    value: FIXTURE_CREDENTIAL,
    bounds: { x: 20, y: 30, width: 240, height: 44 },
    center: { x: 140, y: 52 },
    state: { enabled: true, focused: true, visible: true, clickable: true },
    labels: { ariaLabel: 'Account password' },
    attributes: { type: 'password', 'data-testid': 'password' },
  }
}

function passwordScreen(element: ElementInfo): ScreenState {
  return {
    platform: 'web',
    tree: 'textbox Account password',
    elements: [element],
    refMap: {
      [element.ref]: { bounds: element.bounds!, center: element.center! },
    },
    url: 'https://shop.example/checkout',
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: {
        offsetX: 0,
        offsetY: 0,
        contentWidth: 1_280,
        contentHeight: 720,
      },
    },
  }
}

function handoff(screenshotSha: string, domSha: string): CompletedRunHandoff {
  const element = passwordElement()
  const state = passwordScreen(element)
  return {
    schemaVersion: 3,
    runId: asRunId('run-capture-safety-378-27'),
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [
      {
        testId: 'checkout::credential-entry',
        testIndex: 0,
        outcome: 'passed',
        steps: [
          {
            stepIndex: 0,
            stepText: 'Focus the password field',
            cacheStatus: 'miss',
            servedBrief: {
              scope: { tier: 'product', key: 'storefront' },
              asOfBuild: 42,
              budget: 1_000,
              truncation: 'none',
              channel1: [],
              channel2: [],
              channel3: [],
              briefDigest: 'brief-digest',
            },
            subActions: [
              {
                plan: 'Focus the credential textbox',
                plannedAction: { type: 'click', ref: element.ref },
                stateBefore: state,
                stateAfter: state,
                result: { success: true },
                decisionScreenshotRef: {
                  id: `decision-screenshot:${screenshotSha}`,
                  sha: screenshotSha,
                },
                artifactRefs: [
                  { id: `dom-snapshot:${domSha}`, sha: domSha },
                ],
              },
            ],
            verifierVerdict: { pass: true, reasoning: 'Password field focused' },
          },
        ],
      },
    ],
  }
}

describe('production capture-safety transport (SAFE-02)', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('excludes credential screenshots and preserves pre-hash DOM redaction through commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-curation-capture-safety-'))
    roots.push(root)
    const runDir = join(root, 'runs', 'run-capture-safety-378-27')
    const blobsDir = join(runDir, 'blobs')
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const auditBaseDir = join(root, '.agent-qa')
    mkdirSync(blobsDir, { recursive: true })

    const screenshotBytes = Buffer.from('fixture screenshot with credential-region pixels')
    const screenshotSha = sha(screenshotBytes)
    const rawDomText = JSON.stringify({
      role: 'textbox',
      name: 'Account password',
      value: FIXTURE_CREDENTIAL,
    })
    const rawDomBytes = Buffer.from(rawDomText)
    const rawDomSha = sha(rawDomBytes)
    const safeDomText = rawDomText.replaceAll(FIXTURE_CREDENTIAL, REDACTION_PLACEHOLDER)
    const safeDomBytes = Buffer.from(safeDomText)
    const safeDomSha = sha(safeDomBytes)
    expect(safeDomSha === rawDomSha).toBe(false)
    writeFileSync(join(blobsDir, screenshotSha), screenshotBytes)
    writeFileSync(join(blobsDir, rawDomSha), rawDomBytes)

    const emitted = emitCurationCandidates({
      handoff: handoff(screenshotSha, rawDomSha),
      runDir,
      knowledgeRoot,
    })

    expect(emitted).toMatchObject({
      enqueued: 1,
      coalesced: 0,
      capExceeded: 0,
      refused: 0,
    })
    const candidateId = emitted.details[0]?.candidateId
    expect(candidateId).toMatch(/^[0-9a-f]{64}$/)
    if (candidateId === undefined) throw new Error('expected queue-finalized candidate id')
    const queuedDir = queuedCandidateDir(knowledgeRoot, candidateId)
    const payloadText = readFileSync(join(queuedDir, 'payload.json'), 'utf8')
    const payload = JSON.parse(payloadText) as CurationCandidatePayload
    expect(payload.artifactInventory).toEqual([
      {
        relativePath: `artifacts/${safeDomSha}`,
        sha256: safeDomSha,
        bytes: safeDomBytes.byteLength,
        stepIndex: 0,
        role: 'dom-snapshot',
        originalName: 'dom-snapshot.json',
      },
    ])
    expect(payload.captureReceipt).toEqual({
      regions: [
        {
          stepIndex: 0,
          elementRef: 'password-field',
          role: 'textbox',
          normalizedName: 'account password',
          inputType: 'password',
          reason: 'password-input',
        },
      ],
      interactions: [{ stepIndex: 0, elementRef: 'password-field' }],
      omissions: [
        {
          stepIndex: 0,
          ref: `decision-screenshot:${screenshotSha}`,
          role: 'screenshot',
          originalName: 'decision-screenshot.png',
          reason: 'capture-blacklist',
        },
      ],
      redactions: [
        {
          stepIndex: 0,
          ref: `dom-snapshot:${rawDomSha}`,
          role: 'dom-snapshot',
          originalName: 'dom-snapshot.json',
          reason: 'capture-blacklist',
          safeSha256: safeDomSha,
        },
      ],
    })
    expect(hasOwnPropertyDeep(payload.captureReceipt, 'value')).toBe(false)
    expect(payloadText.includes(FIXTURE_CREDENTIAL)).toBe(false)
    expect(readFileSync(join(queuedDir, 'artifacts', safeDomSha))).toEqual(safeDomBytes)
    expect(existsSync(join(queuedDir, 'artifacts', screenshotSha))).toBe(false)
    expect(existsSync(join(queuedDir, 'artifacts', rawDomSha))).toBe(false)
    const queueFiles = filesUnder(queueRoot(knowledgeRoot))
    expect(queueFiles.some((path) => basename(path) === screenshotSha)).toBe(false)
    expect(queueFiles.some((path) => readFileSync(path).equals(screenshotBytes))).toBe(false)
    expect(queueFiles.some((path) => readFileSync(path).includes(FIXTURE_CREDENTIAL))).toBe(false)

    const author: CuratorAuthor = async () => ({
      kind: 'fallback-required',
      reason: 'no-model',
    })
    const drained = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    })

    expect(drained).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 1,
      failures: 0,
    })
    const bundles = enumerateBundleDirs(knowledgeRoot)
    expect(bundles).toHaveLength(1)
    const bundleDir = bundles[0]!.dir
    const loaded = loadBundle(bundleDir)
    expect(loaded.kind).toBe('loaded')
    if (loaded.kind !== 'loaded') throw new Error('expected committed capture-safe bundle')
    expect(loaded.bundle.frontmatter.evidenceIncomplete).toBe(true)
    expect(loaded.bundle.manifest.evidenceIncomplete).toBe(true)
    expect(loaded.bundle.artifactsIndex.artifacts).toEqual([
      expect.objectContaining({
        sha: safeDomSha,
        bytes: safeDomBytes.byteLength,
        stepIndex: 0,
        role: 'dom-snapshot',
        originalName: 'dom-snapshot.json',
      }),
    ])
    expect(loaded.bundle.artifactsIndex.skipped).toEqual([
      expect.objectContaining({
        id: `decision-screenshot:${screenshotSha}`,
        stepIndex: 0,
        reason: 'capture-blacklist',
      }),
    ])
    expect(readFileSync(join(bundleDir, 'artifacts', safeDomSha))).toEqual(safeDomBytes)
    expect(existsSync(join(bundleDir, 'artifacts', screenshotSha))).toBe(false)
    expect(existsSync(join(bundleDir, 'artifacts', rawDomSha))).toBe(false)
    const bundleFiles = filesUnder(bundleDir)
    expect(bundleFiles.some((path) => basename(path) === screenshotSha)).toBe(false)
    expect(bundleFiles.some((path) => readFileSync(path).equals(screenshotBytes))).toBe(false)
    expect(bundleFiles.some((path) => readFileSync(path).includes(FIXTURE_CREDENTIAL))).toBe(false)
    expect(verifyBundleIntegrity(bundleDir)).toEqual({ ok: true, violations: [] })
  })
})
