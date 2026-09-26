import type { ConfigPathSegment } from "@vostride/agent-qa-schema"

export interface SecretValueTarget {
  segments: readonly ConfigPathSegment[]
  pattern: string
}

export interface SecretValueProps {
  field: SecretValueTarget
  label: string
  maskedText: string
}

export function SecretValue({ maskedText }: SecretValueProps) {
  return (
    <div data-secret-field>
      <code>{maskedText}</code>
    </div>
  )
}
