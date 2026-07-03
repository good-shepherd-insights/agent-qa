// Secret machinery for the runner-owned step-execution loop (Phase 353, D-02).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no model/core/adapter package imports. Moved byte-equivalently from
// core/src/agent/secrets.ts — this is the cache-poisoning guard (Information-
// disclosure control): the `[secret:*]` marker regex, redaction, and template
// resolution must not change behavior. `parseEnvFile` is inlined locally (was the
// module's only cross-package import) to keep runner self-contained and pure.

import type { SecretRedactorPort, SecretResolver } from './ports.js'

export interface SecretTemplate {
  pattern: string
  name: string
}

export interface SecretFileMetadata {
  count: number
}

export class SecretConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretConfigError'
  }
}

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(`Secret not found: ${name}`)
    this.name = 'MissingSecretError'
  }
}

const SECRET_NAME_RE = /^\w+$/
const SECRET_TEMPLATE_RE = /\{\{secret:(\w+)\}\}/g
const REDACTED_SECRET_MARKER_RE = /\[secret:\w+\]/

function assertSecretName(name: string): void {
  if (!SECRET_NAME_RE.test(name)) {
    throw new SecretConfigError(`Invalid secret name: ${name}`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Inlined from core variables.ts:parseEnvFile — pure string parsing, kept local so
// the runner secret store has no cross-package import (storageNeutral).
function parseSecretEnvFile(content: string): Record<string, string> {
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

export class SecretStore implements SecretResolver {
  private storage = new Map<string, string>()

  constructor(secrets: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(secrets)) {
      this.set(name, value)
    }
  }

  static empty(): SecretStore {
    return new SecretStore()
  }

  static fromEnvContent(content: string): SecretStore {
    return new SecretStore(parseSecretEnvFile(content))
  }

  private set(name: string, value: string): void {
    assertSecretName(name)
    this.storage.set(name, value)
  }

  get(name: string): string | undefined {
    return this.storage.get(name)
  }

  require(name: string): string {
    const value = this.get(name)
    if (value === undefined) throw new MissingSecretError(name)
    return value
  }

  has(name: string): boolean {
    return this.storage.has(name)
  }

  count(): number {
    return this.storage.size
  }

  metadata(): SecretFileMetadata {
    return { count: this.count() }
  }

  forEachSecret(callback: (name: string, value: string) => void): void {
    for (const [name, value] of this.storage) {
      callback(name, value)
    }
  }
}

export function findSecretTemplates(text: string): SecretTemplate[] {
  const templates: SecretTemplate[] = []
  SECRET_TEMPLATE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SECRET_TEMPLATE_RE.exec(text)) !== null) {
    templates.push({ pattern: match[0], name: match[1] })
  }
  return templates
}

export function interpolateSecretTemplates(template: string, store: SecretStore): string {
  return template.replace(SECRET_TEMPLATE_RE, (match, name: string) => {
    const value = store.get(name)
    return value === undefined ? match : value
  })
}

export function resolveSecretTemplatesInValue<T>(value: T, store?: SecretResolver): T {
  if (!store) return value
  if (typeof value === 'string') {
    return value.replace(SECRET_TEMPLATE_RE, (_match, name: string) => store.require(name)) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSecretTemplatesInValue(item, store)) as T
  }
  if (isBufferLike(value)) {
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveSecretTemplatesInValue(item, store)
    }
    return result as T
  }
  return value
}

export function redactSecretValue<T>(value: T, redactor?: SecretRedactorPort): T {
  if (!redactor) return value
  if (typeof value === 'string') {
    return redactor.redactString(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretValue(item, redactor)) as T
  }
  if (isBufferLike(value)) {
    return value
  }
  if (value instanceof Error) {
    const redacted = new Error(redactor.redactString(value.message))
    redacted.name = value.name
    redacted.stack = value.stack ? redactor.redactString(value.stack) : undefined
    return redacted as T
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactSecretValue(item, redactor)
    }
    return result as T
  }
  return value
}

/**
 * The cached-plan invalidation predicate (loop cache-poisoning guard): returns true
 * when a value contains a redacted `[secret:*]` marker. Moved from core loop.ts.
 */
export function containsRedactedSecretMarker(value: unknown): boolean {
  if (typeof value === 'string') return REDACTED_SECRET_MARKER_RE.test(value)
  if (Array.isArray(value)) return value.some((item) => containsRedactedSecretMarker(item))
  if (isBufferLike(value)) return false
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some((item) => containsRedactedSecretMarker(item))
  }
  return false
}

function isBufferLike(value: unknown): value is Buffer {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value)
}

export class SecretRedactor implements SecretRedactorPort {
  private valuePatterns: Array<{ re: RegExp; marker: string }> = []

  constructor(private readonly store: SecretStore, private readonly genericMarker = '[secret]') {
    store.forEachSecret((_name, value) => {
      if (value.length === 0) return
      this.valuePatterns.push({ re: new RegExp(escapeRegExp(value), 'g'), marker: genericMarker })
    })
  }

  redactString(value: string): string {
    let redacted = value.replace(SECRET_TEMPLATE_RE, (_match, name: string) => `[secret:${name}]`)
    for (const pattern of this.valuePatterns) {
      redacted = redacted.replace(pattern.re, pattern.marker)
    }
    return redacted
  }

  redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redactString(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item))
    }
    if (isBufferLike(value)) {
      return value
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.redactString(value.message),
        stack: value.stack ? this.redactString(value.stack) : undefined,
      }
    }
    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.redactValue(item)
      }
      return result
    }
    return value
  }
}
