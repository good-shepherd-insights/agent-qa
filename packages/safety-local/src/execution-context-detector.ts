import {
  resolveExecutionContext,
  setActiveExecutionContextResolver,
  type ExecutionContextSignals,
} from '@vostride/agent-qa-safety'
import type { ExecutionContext } from '@vostride/agent-qa-schema'

export const CI_VENDOR_VARS = new Set([
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'BUILDKITE',
  'JENKINS_URL',
  'TRAVIS',
  'APPVEYOR',
  'TF_BUILD',
  'CODEBUILD_BUILD_ID',
  'DRONE',
  'SEMAPHORE',
  'BITBUCKET_BUILD_NUMBER',
  'TEAMCITY_VERSION',
] as const)

function isTruthy(value?: string): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized !== undefined && normalized !== '' && normalized !== '0' && normalized !== 'false'
}

function isPresent(value?: string): boolean {
  return value !== undefined && value.trim() !== ''
}

export function readSignals(env: NodeJS.ProcessEnv = process.env): ExecutionContextSignals {
  let hasVendorMarker = false

  for (const name of CI_VENDOR_VARS) {
    if (isPresent(env[name])) {
      hasVendorMarker = true
      break
    }
  }

  return {
    isTty: Boolean(process.stdout?.isTTY) && Boolean(process.stdin?.isTTY),
    ciMarkers: isTruthy(env.CI) || hasVendorMarker,
  }
}

export function detectExecutionContext(override?: ExecutionContext): ExecutionContext {
  return resolveExecutionContext(readSignals(), override)
}

setActiveExecutionContextResolver(() => detectExecutionContext())
