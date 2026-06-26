import type { ModelProfile, ModelProviderId } from '@vostride/agent-qa-schema'

export function validateProfile(profile: ModelProfile): void {
  if (profile.provider === 'openai-compatible' && !profile.baseURL) {
    throw new Error('OpenAI-Compatible provider requires a baseURL')
  }

  if (profile.provider === 'anthropic-compatible' && !profile.baseURL) {
    throw new Error('Anthropic-Compatible provider requires a baseURL')
  }

  if (profile.headers && profile.provider !== 'anthropic-compatible') {
    throw new Error(
      `${displayProvider(profile.provider)} provider custom headers are only supported on anthropic-compatible`,
    )
  }
}

function displayProvider(provider: ModelProviderId): string {
  switch (provider) {
    case 'openai-compatible':
      return 'OpenAI-Compatible'
    case 'anthropic-compatible':
      return 'Anthropic-Compatible'
    case 'openai-subscription':
      return 'OpenAI Subscription'
    case 'anthropic-subscription':
      return 'Anthropic Subscription'
    case 'gemini':
      return 'Gemini'
  }
}
