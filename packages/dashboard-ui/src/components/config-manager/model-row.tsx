// ONE SAVED MODEL (429-23 · D-10, D-11, D-12 · UI-SPEC S4 "Closed row", "Open row panel").
//
// The closed row is its disclosure button: the name, the Default badge, the model line and one
// status word derived from the credential-status read. The open panel sits inside the same row.

import { useId } from "react"
import { ChevronRight, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { AuthCredentialInfo, LLMProviderMetadata } from "@/lib/api"
import {
  DEFAULT_BADGE,
  MODEL_STATUS_WORDS,
  PROVIDER_FALLBACK_LABELS,
  SUBSCRIPTION_PLAN_NAMES,
  connectionSentence,
  fixedFactsLine,
  modelLine,
} from "@/lib/config-copy"
import type { ModelStatus } from "@/lib/config-tabs"
import { cn } from "@/lib/utils"

export interface SavedModel {
  name: string
  provider: string
  model: string
  baseURL?: string
  providerHeaders?: Record<string, string>
  vision?: boolean
  contextWindow?: string
}

function isBearer(credential: AuthCredentialInfo): boolean {
  return credential.type === "bearer" || credential.type === "bearer-token"
}

function credentialMatches(credential: AuthCredentialInfo, model: SavedModel): boolean {
  if (credential.configName !== model.name) return false
  if (credential.type === "oauth") return credential.provider === model.provider
  if (isBearer(credential)) return model.provider === "anthropic-compatible" && credential.provider === "anthropic-compatible"
  return credential.provider === model.provider
}

/** The row's one status word: only what the credential-status read says, matched by name and provider. */
export function modelStatus(credentials: readonly AuthCredentialInfo[], model: SavedModel, now: number): ModelStatus {
  const credential = credentials.find((candidate) => credentialMatches(candidate, model))
  if (credential === undefined) return "not-connected"
  if (credential.type === "oauth") {
    return credential.expires !== null && credential.expires < now ? "sign-in-expired" : "signed-in"
  }
  return "key-saved"
}

export interface ProviderFacts {
  label: string | undefined
  signIn: boolean
  keyOptional: boolean
}

export function providerFacts(providers: readonly LLMProviderMetadata[], id: string): ProviderFacts {
  const metadata = providers.find((provider) => provider.id === id)
  const fallbackLabel = (PROVIDER_FALLBACK_LABELS as Record<string, string>)[id]
  const signIn = metadata ? metadata.auth.kind === "oauth-plugin" : id in SUBSCRIPTION_PLAN_NAMES
  const keyOptional = metadata
    ? metadata.auth.kind === "api-key" && metadata.auth.optional === true
    : id === "openai-compatible" || id === "anthropic-compatible"
  return { label: metadata?.label ?? fallbackLabel, signIn, keyOptional }
}

function planName(provider: string, label: string | undefined): string {
  return (SUBSCRIPTION_PLAN_NAMES as Record<string, string>)[provider] ?? label ?? ""
}

interface ModelRowProps {
  model: SavedModel
  status: ModelStatus
  facts: ProviderFacts
  isDefault: boolean
  open: boolean
  onToggle: () => void
}

export function ModelRow({ model, status, facts, isDefault, open, onToggle }: ModelRowProps) {
  const panelId = useId()
  const line = facts.label === undefined ? model.model : modelLine(model.model, facts.label)
  const expired = status === "sign-in-expired"

  return (
    <li
      data-model-row
      data-model-name={model.name}
      data-model-status={status}
      data-model-default={isDefault ? "true" : undefined}
      data-model-open={open ? "true" : "false"}
    >
      <button
        type="button"
        data-model-row-toggle
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="group grid min-h-12 w-full grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-4 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight
          className="row-span-2 size-3 text-muted-foreground group-aria-expanded:rotate-90"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-model-row-name className="font-mono text-sm font-medium wrap-anywhere">
            {model.name}
          </span>
          {isDefault ? (
            <Badge variant="outline" data-model-default-badge>
              {DEFAULT_BADGE}
            </Badge>
          ) : null}
        </span>
        <span
          data-model-row-status
          className={cn(
            "row-span-2 flex items-center gap-1 text-xs",
            expired ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {expired ? <TriangleAlert className="size-3 text-amber-500" aria-hidden="true" /> : null}
          {MODEL_STATUS_WORDS[status]}
        </span>
        <span data-model-row-model className="col-start-2 truncate text-xs text-muted-foreground" title={line}>
          {line}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          data-model-panel
          className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 bg-muted/40 px-4 py-4"
        >
          <div className="col-start-2 min-w-0 space-y-4">
            <div data-model-connection className="space-y-2">
              <p className="text-sm">
                {connectionSentence(status, planName(model.provider, facts.label), {
                  signIn: facts.signIn,
                  keyOptional: facts.keyOptional,
                })}
              </p>
            </div>
            {facts.label === undefined ? null : (
              <p data-model-fixed className="text-xs text-muted-foreground">
                {fixedFactsLine(facts.label)}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </li>
  )
}
