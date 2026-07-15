import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import { ArtifactsIndexSchema } from '@vostride/agent-qa-schema'
import { copyArtifacts } from '../../artifact-copy.js'
import type { ArtifactCopyInput } from '../../artifact-copy.js'
import { renderArtifactIndex } from '../../bundle-parts.js'
import {
  CAPTURE_BLACKLIST_NAME_PATTERNS,
  CAPTURE_BLACKLIST_REDACTION_PLACEHOLDER,
  classifyCaptureBlacklist,
  filterArtifactsForCapture,
  sanitizeCaptureBlacklistEvidence,
} from '../capture-blacklist.js'
import type { SanitizedCaptureBlacklistRegion } from '../capture-blacklist.js'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('classifyCaptureBlacklist', () => {
  it('sanitizes, sorts, and deduplicates durable regions without source values', () => {
    const regions = sanitizeCaptureBlacklistEvidence([
      {
        stepIndex: 4,
        elementRef: 'z-password',
        role: 'textbox',
        normalizedName: 'password',
        inputType: 'password',
        value: 'must-not-survive',
        reason: 'password-input',
      },
      {
        stepIndex: 2,
        elementRef: 'api-key',
        role: 'searchbox',
        normalizedName: 'api key',
        value: 'also-must-not-survive',
        reason: 'credential-name',
      },
      {
        stepIndex: 4,
        elementRef: 'z-password',
        role: 'textbox',
        normalizedName: 'password',
        inputType: 'password',
        value: 'duplicate-raw-value',
        reason: 'password-input',
      },
    ])

    expect(regions).toEqual([
      {
        stepIndex: 2,
        elementRef: 'api-key',
        role: 'searchbox',
        normalizedName: 'api key',
        reason: 'credential-name',
      },
      {
        stepIndex: 4,
        elementRef: 'z-password',
        role: 'textbox',
        normalizedName: 'password',
        inputType: 'password',
        reason: 'password-input',
      },
    ])
    expect(JSON.stringify(regions)).not.toContain('must-not-survive')
    expectTypeOf<SanitizedCaptureBlacklistRegion>().not.toHaveProperty('value')
  })

  it('blacklists textbox-class password inputs', () => {
    expect(
      classifyCaptureBlacklist({
        elements: [
          {
            stepIndex: 0,
            elementRef: 'password-field',
            role: 'textbox',
            name: 'Account credential',
            inputType: 'PASSWORD',
            value: 'correct horse battery staple',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        elementRef: 'password-field',
        reason: 'password-input',
      }),
    ])
  })

  it.each(CAPTURE_BLACKLIST_NAME_PATTERNS)(
    'blacklists textbox-class normalized names containing %s',
    (pattern) => {
      const [region] = classifyCaptureBlacklist({
        elements: [
          {
            stepIndex: 3,
            elementRef: `field-${pattern}`,
            role: 'searchbox',
            name: `  Enter   ${pattern.toUpperCase()}   value  `,
          },
        ],
      })

      expect(region).toMatchObject({
        stepIndex: 3,
        elementRef: `field-${pattern}`,
        normalizedName: `enter ${pattern} value`,
        reason: 'credential-name',
      })
    },
  )

  it('does not blacklist ordinary textboxes or credential-shaped names on non-textboxes', () => {
    expect(
      classifyCaptureBlacklist({
        elements: [
          {
            stepIndex: 0,
            elementRef: 'search-field',
            role: 'textbox',
            name: 'Search products',
          },
          {
            stepIndex: 0,
            elementRef: 'password-hint-button',
            role: 'button',
            name: 'Show password hint',
          },
        ],
      }),
    ).toEqual([])
  })
})

describe('capture blacklist artifact filtering', () => {
  let root: string
  let sourceDir: string
  let destArtifactsDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-capture-blacklist-'))
    sourceDir = join(root, 'sources')
    destArtifactsDir = join(root, 'artifacts')
    mkdirSync(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function artifact(
    name: string,
    bytes: Uint8Array,
    stepIndex: number,
    role: string,
  ): ArtifactCopyInput {
    const sourcePath = join(sourceDir, name)
    writeFileSync(sourcePath, bytes)
    return {
      ref: { id: `artifact-${name}`, sha: sha256(bytes) },
      sourcePath,
      stepIndex,
      role,
      originalName: name,
    }
  }

  function blacklist() {
    return classifyCaptureBlacklist({
      elements: [
        {
          stepIndex: 4,
          elementRef: 'credential-field',
          role: 'textbox',
          name: 'API key',
          value: 'fixture-sensitive-value',
        },
      ],
    })
  }

  it('skips only the producing-step screenshot and records capture-blacklist in inventory', () => {
    const blockedScreenshot = artifact('blocked.png', Buffer.from('blocked pixels'), 4, 'screenshot')
    const unrelatedScreenshot = artifact('unrelated.png', Buffer.from('safe pixels'), 5, 'screenshot')
    const filtered = filterArtifactsForCapture({
      artifacts: [blockedScreenshot, unrelatedScreenshot],
      blacklist: blacklist(),
      stepInteractions: [{ stepIndex: 4, elementRef: 'credential-field' }],
    })

    const inventory = copyArtifacts(filtered.toCopy, destArtifactsDir, {
      preSkipped: filtered.skipped,
    })

    expect(inventory.copied.map(({ ref }) => ref.id)).toEqual([unrelatedScreenshot.ref.id])
    expect(inventory.skipped).toEqual([
      {
        ref: blockedScreenshot.ref,
        stepIndex: 4,
        role: 'screenshot',
        originalName: 'blocked.png',
        reason: 'capture-blacklist',
      },
    ])
    expect(inventory.evidenceIncomplete).toBe(true)
    expect(ArtifactsIndexSchema.parse(renderArtifactIndex(inventory)).skipped).toEqual([
      {
        id: blockedScreenshot.ref.id,
        sha: blockedScreenshot.ref.sha,
        stepIndex: 4,
        path: `artifacts/${blockedScreenshot.ref.sha}`,
        reason: 'capture-blacklist',
      },
    ])
  })

  it.each(['dom-snapshot', 'ax-snapshot'])(
    'copies a %s with blacklisted values redacted and content-addressed from safe bytes',
    (role) => {
      const originalValue = 'fixture-sensitive-value'
      const snapshot = artifact(
        `${role}.json`,
        Buffer.from(JSON.stringify({ ref: 'credential-field', value: originalValue })),
        4,
        role,
      )
      const filtered = filterArtifactsForCapture({
        artifacts: [snapshot],
        blacklist: blacklist(),
        stepInteractions: [{ stepIndex: 4, elementRef: 'credential-field' }],
      })

      const inventory = copyArtifacts(filtered.toCopy, destArtifactsDir, {
        preSkipped: filtered.skipped,
      })
      const copied = inventory.copied[0]!
      const copiedBytes = readFileSync(join(root, copied.relPath), 'utf8')

      expect(inventory.skipped).toEqual([])
      expect(filtered.toCopy[0]?.redactValues).toContain(originalValue)
      expect(copied).toMatchObject({ role, originalName: `${role}.json` })
      expect(copiedBytes).toContain(CAPTURE_BLACKLIST_REDACTION_PLACEHOLDER)
      expect(copiedBytes).not.toContain(originalValue)
      expect(copied.ref.sha).toBe(sha256(Buffer.from(copiedBytes)))
      expect(copied.ref.sha).not.toBe(snapshot.ref.sha)
    },
  )

  it('fails closed for opaque and unrecognized artifacts on a blacklisted interaction', () => {
    const opaque = artifact(
      'opaque.bin',
      Buffer.from('opaque credential bytes'),
      4,
      'opaque-evidence',
    )
    const unrecognized = artifact(
      'unknown.txt',
      Buffer.from('unknown credential bytes'),
      4,
      'other',
    )
    const ordinary = artifact('ordinary.bin', Buffer.from('ordinary bytes'), 5, 'opaque-evidence')

    const filtered = filterArtifactsForCapture({
      artifacts: [opaque, unrecognized, ordinary],
      blacklist: blacklist(),
      stepInteractions: [{ stepIndex: 4, elementRef: 'credential-field' }],
    })

    expect(filtered.toCopy).toEqual([ordinary])
    expect(filtered.skipped).toEqual([
      {
        ref: opaque.ref,
        stepIndex: 4,
        role: 'opaque-evidence',
        originalName: 'opaque.bin',
        reason: 'capture-blacklist',
      },
      {
        ref: unrecognized.ref,
        stepIndex: 4,
        role: 'opaque-evidence',
        originalName: 'unknown.txt',
        reason: 'capture-blacklist',
      },
    ])
  })
})
