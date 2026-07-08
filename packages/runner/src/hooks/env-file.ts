// Hook .env variable file parsing/serialization (Phase 363 D-06). Moved
// byte-equivalently from core/src/agent/variables.ts — the DockerHookExecutor
// (runner-local) reads /tmp/agent-qa.env through `parseEnvFile`, so the pure
// string codec now lives beside the hook contracts in the runner. core's
// variables.ts re-exports these until Plan 05 deletes that file.

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export function serializeEnvFile(vars: Record<string, string>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    if (value.includes(' ') || value.includes('"') || value.includes("'") || value === '') {
      lines.push(`${key}="${value.replace(/"/g, '\\"')}"`)
    } else {
      lines.push(`${key}=${value}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}
