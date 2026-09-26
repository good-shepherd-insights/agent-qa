import { CONFIG_SECTION_LABELS } from './config-copy'

export type ConfigTab = string
export type ConfigSectionId = string
export type LegacyConfigPair = string
export type SaveState = string
export type FieldState = string
export type ConnectionChoice = string
export type ModelStatus = string
export type TestResult = string
export type ExplicitActionKind = string
export type RevealState = string

export const CONFIG_TABS: readonly ConfigTab[] = []
export const CONFIG_SECTIONS: Record<ConfigTab, readonly ConfigSectionId[]> = {}
export const CONFIG_SECTION_IDS: readonly ConfigSectionId[] = []
export const CONFIG_SECTION_ALIASES: Record<ConfigSectionId, readonly string[]> = {}
export const LEGACY_CONFIG_PAIRS: readonly LegacyConfigPair[] = []
export const LEGACY_CONFIG_LINKS: Record<LegacyConfigPair, { tab: ConfigTab; section: ConfigSectionId }> = {}
export const SAVE_STATES: readonly SaveState[] = []
export const FIELD_STATES: readonly FieldState[] = []
export const CONNECTION_CHOICES: readonly ConnectionChoice[] = []
export const CONNECTION_CHOICE_PROVIDERS: Record<ConnectionChoice, string> = {}
export const MODEL_STATUSES: readonly ModelStatus[] = []
export const TEST_RESULTS: readonly TestResult[] = []
export const EXPLICIT_ACTION_KINDS: readonly ExplicitActionKind[] = []
export const REVEAL_STATES: readonly RevealState[] = []

export type LegacyConfigLink =
  | { kind: 'none' }
  | { kind: 'mapped'; tab: ConfigTab; section: ConfigSectionId }
  | { kind: 'unknown' }

export function resolveLegacyConfigLink(_searchParams: URLSearchParams): LegacyConfigLink {
  return { kind: 'none' }
}

export function resolveConfigTab(_param: string | null | undefined): ConfigTab | undefined {
  return undefined
}

export function configTabPath(_tab: ConfigTab, _section?: ConfigSectionId): string {
  return ''
}

export function searchConfigSections(_query: string): { tab: ConfigTab; section: ConfigSectionId }[] {
  void CONFIG_SECTION_LABELS
  return []
}
