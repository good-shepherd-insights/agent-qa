import {
  ARTIFACT_VALUE_REDACTION_PLACEHOLDER,
  type ArtifactCopyInput,
  type SkippedArtifact,
} from '../artifact-copy.js'
import type {
  CurationArtifactRole,
  CurationCaptureReceipt,
} from '../queue/queue-payload.js'

export const CAPTURE_BLACKLIST_NAME_PATTERNS = [
  'password',
  'passcode',
  'otp',
  'one-time',
  '2fa',
  'mfa',
  'cvv',
  'pin',
  'secret',
  'token',
  'api key',
] as const

export const CAPTURE_BLACKLIST_REDACTION_PLACEHOLDER =
  ARTIFACT_VALUE_REDACTION_PLACEHOLDER

const TEXTBOX_CLASS_ROLES = new Set(['textbox', 'searchbox', 'combobox'])
const SCREENSHOT_ROLES = new Set(['screenshot', 'screen-image'])
const SNAPSHOT_ROLES = new Set([
  'dom',
  'dom-snapshot',
  'ax',
  'ax-snapshot',
  'accessibility-snapshot',
])

export interface CaptureElementEvidence {
  stepIndex: number
  elementRef: string
  role: string
  name: string
  nameNormalized?: string
  inputType?: string
  value?: string
}

export interface CaptureBlacklistEvidence {
  elements: readonly CaptureElementEvidence[]
}

export interface BlacklistedRegion {
  stepIndex: number
  elementRef: string
  role: string
  normalizedName: string
  inputType?: string
  value?: string
  reason: 'password-input' | 'credential-name'
}

export interface CaptureStepInteraction {
  stepIndex: number
  elementRef?: string
}

export type SanitizedCaptureBlacklistRegion = CurationCaptureReceipt['regions'][number]

export interface CaptureBlacklistSkippedArtifact
  extends SkippedArtifact<'capture-blacklist'> {
  role: CurationArtifactRole
  originalName: string
}

export interface FilterArtifactsForCaptureInput {
  artifacts: readonly ArtifactCopyInput[]
  blacklist: readonly BlacklistedRegion[]
  stepInteractions: readonly CaptureStepInteraction[]
}

export interface FilterArtifactsForCaptureResult {
  toCopy: ArtifactCopyInput[]
  skipped: CaptureBlacklistSkippedArtifact[]
}

function normalize(value: string): string {
  return value.trim().toLowerCase().split(/\s+/u).join(' ')
}

function textboxClass(role: string): boolean {
  return TEXTBOX_CLASS_ROLES.has(normalize(role))
}

/** Fixed, deterministic AX evidence classifier; detector regexes remain owned by safety. */
export function classifyCaptureBlacklist(
  evidence: CaptureBlacklistEvidence,
): BlacklistedRegion[] {
  return evidence.elements.flatMap((element) => {
    if (!textboxClass(element.role)) return []

    const normalizedName = normalize(element.nameNormalized ?? element.name)
    const inputType = element.inputType === undefined
      ? undefined
      : normalize(element.inputType)
    const passwordInput = inputType === 'password'
    const credentialName = CAPTURE_BLACKLIST_NAME_PATTERNS.some((pattern) =>
      normalizedName.includes(pattern),
    )
    if (!passwordInput && !credentialName) return []

    return [{
      stepIndex: element.stepIndex,
      elementRef: element.elementRef,
      role: normalize(element.role),
      normalizedName,
      ...(inputType === undefined ? {} : { inputType }),
      ...(element.value === undefined ? {} : { value: element.value }),
      reason: passwordInput ? 'password-input' as const : 'credential-name' as const,
    }]
  })
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Removes raw values and returns one deterministic durable row per step/ref/reason. */
export function sanitizeCaptureBlacklistEvidence(
  regions: readonly BlacklistedRegion[],
): SanitizedCaptureBlacklistRegion[] {
  const sanitized = regions
    .map((region): SanitizedCaptureBlacklistRegion => ({
      stepIndex: region.stepIndex,
      elementRef: region.elementRef,
      role: region.role,
      normalizedName: region.normalizedName,
      ...(region.inputType === undefined ? {} : { inputType: region.inputType }),
      reason: region.reason,
    }))
    .sort((left, right) =>
      left.stepIndex - right.stepIndex
      || compareText(left.elementRef, right.elementRef)
      || compareText(left.reason, right.reason)
      || compareText(left.role, right.role)
      || compareText(left.normalizedName, right.normalizedName)
      || compareText(left.inputType ?? '', right.inputType ?? ''),
    )

  const seen = new Set<string>()
  return sanitized.filter((region) => {
    const key = JSON.stringify([region.stepIndex, region.elementRef, region.reason])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function matchesInteraction(
  region: BlacklistedRegion,
  interaction: CaptureStepInteraction,
): boolean {
  return region.stepIndex === interaction.stepIndex
    && (interaction.elementRef === undefined || interaction.elementRef === region.elementRef)
}

function artifactRole(artifact: ArtifactCopyInput): string {
  return normalize(artifact.role ?? '')
}

function captureArtifactRole(artifact: ArtifactCopyInput): CurationArtifactRole {
  const role = artifactRole(artifact)
  if (SCREENSHOT_ROLES.has(role)) return 'screenshot'
  if (role === 'dom' || role === 'dom-snapshot') return 'dom-snapshot'
  if (SNAPSHOT_ROLES.has(role)) return 'ax-snapshot'
  const name = (artifact.originalName ?? artifact.sourcePath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp'].some((suffix) => name.endsWith(suffix))
    ? 'screenshot'
    : 'opaque-evidence'
}

function artifactOriginalName(artifact: ArtifactCopyInput): string {
  const sourceName = artifact.sourcePath.split(/[\\/]/u).at(-1)
  return artifact.originalName ?? sourceName ?? artifact.ref.id
}

function skippedArtifact(artifact: ArtifactCopyInput): CaptureBlacklistSkippedArtifact {
  return {
    ref: artifact.ref,
    stepIndex: artifact.stepIndex,
    role: captureArtifactRole(artifact),
    originalName: artifactOriginalName(artifact),
    reason: 'capture-blacklist',
  }
}

function uniqueNonEmpty(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value !== ''))]
}

/**
 * Enforces the M2 skip posture before bytes reach copyArtifacts. Screenshots from a step that
 * interacted with a blacklisted region are absent; textual DOM/AX snapshots carry exact-value
 * redaction directives so their copied content address is derived from safe bytes.
 */
export function filterArtifactsForCapture(
  input: FilterArtifactsForCaptureInput,
): FilterArtifactsForCaptureResult {
  const relevant = input.blacklist.filter((region) =>
    input.stepInteractions.some((interaction) => matchesInteraction(region, interaction)),
  )
  const toCopy: ArtifactCopyInput[] = []
  const skipped: CaptureBlacklistSkippedArtifact[] = []

  for (const artifact of input.artifacts) {
    const stepRegions = relevant.filter((region) => region.stepIndex === artifact.stepIndex)
    if (stepRegions.length === 0) {
      toCopy.push(artifact)
      continue
    }
    const role = captureArtifactRole(artifact)
    if (role === 'dom-snapshot' || role === 'ax-snapshot') {
      toCopy.push({
        ...artifact,
        redactValues: uniqueNonEmpty([
          ...(artifact.redactValues ?? []),
          ...stepRegions.map(({ value }) => value),
        ]),
      })
      continue
    }
    skipped.push(skippedArtifact(artifact))
  }

  return { toCopy, skipped }
}
