import type { ConnectionChoice } from './config-tabs'

export const ADD_MODEL_DRAFT_STORAGE_PREFIX = 'agent-qa:config-add-draft:'

export type AddModelKeyType = 'api-key' | 'bearer-token'

export interface AddModelDraft {
  choice?: ConnectionChoice
  baseURL?: string
  model?: string
  name?: string
  nameEdited?: boolean
  keyType?: AddModelKeyType
  headerNames?: string[]
  createdCredential?: boolean
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function suggestModelName(modelId: string): string {
  return modelId
}

export function readAddModelDraft(configPath: string, storage?: Pick<Storage, 'getItem'>): AddModelDraft | undefined {
  void configPath
  void storage
  return undefined
}

export function writeAddModelDraft(configPath: string, draft: AddModelDraft, storage?: DraftStorage): void {
  void configPath
  void draft
  void storage
}

export function clearAddModelDraft(configPath: string, storage?: Pick<Storage, 'removeItem'>): void {
  void configPath
  void storage
}
