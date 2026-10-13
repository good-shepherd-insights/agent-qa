import { existsSync, readFileSync, statSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import type { AgentQaConfig } from '@vostride/agent-qa-core'
import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import type { MaskFn } from '@vostride/agent-qa-schema'
import { loadEnvOverrides, mergeConfigs } from '../config.js'

export class DeclaredSecretsUnavailableError extends Error {
  readonly lines: readonly string[]

  constructor(lines: readonly string[]) {
    super(lines.join(' '))
    this.name = 'DeclaredSecretsUnavailableError'
    this.lines = lines
  }

  static required(): DeclaredSecretsUnavailableError {
    return new DeclaredSecretsUnavailableError([
      'Error: workspace.secretsFile is required. Run `agent-qa init` or set it in agent-qa.config.yaml.',
    ])
  }
}

export interface DeclaredSecretMask {
  readonly mask: MaskFn
  redactor(): SecretRedactor
}

export function readDeclaredSecrets(secretsPath: string): SecretStore {
  if (!existsSync(secretsPath)) {
    throw new DeclaredSecretsUnavailableError([
      `Error: Secrets file not found: ${secretsPath}`,
      'Create the file before running tests. It may be empty, but it must exist.',
    ])
  }
  let content: string
  try {
    content = readFileSync(secretsPath, 'utf-8')
  } catch {
    throw new DeclaredSecretsUnavailableError([
      `Error: Secrets file could not be read: ${secretsPath}`,
      'Check the path and file permissions before running tests.',
    ])
  }
  try {
    return SecretStore.fromEnvContent(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new DeclaredSecretsUnavailableError([`Error: Secrets file is invalid: ${message}`])
  }
}

function resolveSecretsPath(configPath: string): string {
  const file = parseYaml(readFileSync(configPath, 'utf-8')) ?? {}
  const config = mergeConfigs(file, loadEnvOverrides(), {}) as AgentQaConfig | null
  const configured: unknown = config?.workspace?.secretsFile
  if (typeof configured !== 'string' || configured.trim().length === 0) {
    throw DeclaredSecretsUnavailableError.required()
  }
  const workspace = resolveWorkspacePaths({ config: config!, configPath })
  return workspace.secretsFile.absolutePath
}

export function createDeclaredSecretMask(configPath: string): DeclaredSecretMask {
  let secretsPath: string | undefined
  let cached: { key: string; redactor: SecretRedactor } | undefined

  const redactor = (): SecretRedactor => {
    secretsPath ??= resolveSecretsPath(configPath)
    let key: string | undefined
    try {
      const stat = statSync(secretsPath)
      key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`
    } catch {
      key = undefined
    }
    if (key !== undefined && cached?.key === key) return cached.redactor
    const current = new SecretRedactor(readDeclaredSecrets(secretsPath))
    cached = key === undefined ? undefined : { key, redactor: current }
    return current
  }

  return { mask: (text) => redactor().redactString(text), redactor }
}
