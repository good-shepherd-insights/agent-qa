import { asRef } from '@vostride/agent-qa-schema'
import type {
  ArtifactRef,
  BundleDiscriminant,
  BundleDraft,
  ScreenState,
} from '@vostride/agent-qa-schema'

export const BUNDLE_FIXTURE_ARTIFACT_SHA =
  'd9113d37fe29084657c462ac5628ddd56519aeafad8883092a2596075878cbee'
export const BUNDLE_FIXTURE_ARTIFACT_BYTES = Uint8Array.from([
  97, 103, 101, 110, 116, 45, 113, 97, 32, 101, 118, 97, 108, 45, 108, 111, 99, 97, 108,
  32, 102, 105, 120, 116, 117, 114, 101, 32, 98, 108, 111, 98, 10,
])

const fixtureRef = asRef('e-sign-in')
const stepNames = ['Email', 'Password', 'Sign in'] as const

export function makeArtifactFixture(): {
  bytes: Uint8Array
  sha: string
  ref: ArtifactRef
} {
  return {
    bytes: Uint8Array.from(BUNDLE_FIXTURE_ARTIFACT_BYTES),
    sha: BUNDLE_FIXTURE_ARTIFACT_SHA,
    ref: {
      id: 'bundle-fixture-screenshot',
      sha: BUNDLE_FIXTURE_ARTIFACT_SHA,
    },
  }
}

export function makeBundleDraftFixture(
  overrides: Partial<BundleDraft> = {},
): BundleDraft {
  const kind = overrides.kind ?? 'fact'
  const defaultAnchors =
    kind === 'procedure'
      ? ([
          { t: 'flow', name: 'Sign in flow' },
          { t: 'page', route: '/login' },
        ] as const)
      : ([
          { t: 'el', role: 'Button', name: 'Sign in' },
          { t: 'page', route: '/login' },
        ] as const)

  return {
    kind,
    ...(kind === 'fact' ? { subtype: overrides.subtype ?? 'selector' } : {}),
    anchors: [...(overrides.anchors ?? defaultAnchors)],
    scope: overrides.scope ?? { tier: 'product', key: 'fixture-storefront' },
    summary: overrides.summary ?? 'Sign in control on the login page',
    body:
      overrides.body ??
      'Selecting Sign in submits the recorded credentials and advances to the account page.',
    distilledEvidenceRef: overrides.distilledEvidenceRef ?? makeArtifactFixture().ref,
    originStage:
      overrides.originStage ?? ('fixture-curator' as BundleDraft['originStage']),
  }
}

export function makeScreenStateFixture(
  stepIndex = 0,
  overrides: Partial<ScreenState> = {},
): ScreenState {
  const name = stepNames[stepIndex % stepNames.length]!
  const role = name === 'Sign in' ? 'button' : 'textbox'
  const bounds = { x: 48, y: 120 + stepIndex * 56, width: 280, height: 44 }
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }

  return {
    platform: 'web',
    tree: `${role} ${name}`,
    elements: [
      {
        ref: fixtureRef,
        role,
        name,
        nameNormalized: name.toLowerCase(),
        bounds,
        center,
        state: { enabled: true, focused: stepIndex < 2, visible: true, clickable: true },
        labels: { ariaLabel: name },
        attributes: { 'data-fixture-step': String(stepIndex) },
      },
    ],
    refMap: {
      [fixtureRef]: {
        bounds,
        center,
        scrollContext: { offsetX: 0, offsetY: 0 },
      },
    } as ScreenState['refMap'],
    url: 'https://example.test/login',
    timestamp: 1_725_000_000_100 + stepIndex,
    metadata: {
      captureMode: 'full',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      imageWidth: 1_280,
      imageHeight: 720,
      scroll: {
        offsetX: 0,
        offsetY: 0,
        contentWidth: 1_280,
        contentHeight: 720,
      },
    },
    ...overrides,
  }
}

export function makeDiscriminantFixture(
  kind: BundleDraft['kind'] = 'fact',
  subtype: NonNullable<BundleDraft['subtype']> = 'selector',
): BundleDiscriminant {
  switch (kind) {
    case 'fact':
      return subtype === 'measurement'
        ? { kind, subtype, metricKey: 'login latency p95' }
        : {
            kind,
            subtype,
            elementRef: { role: 'Button', name: 'Sign in' },
          }
    case 'procedure':
      return { kind, flowName: 'Sign in flow', stepSignature: 'email>password>submit' }
    case 'caution':
      return { kind, errorKey: 'authentication timed out' }
    case 'unknown':
      return { kind, conflictRecordIds: ['record-b', 'record-a'] }
    case 'policy':
      return { kind, ruleKey: 'never submit production credentials' }
  }
}
