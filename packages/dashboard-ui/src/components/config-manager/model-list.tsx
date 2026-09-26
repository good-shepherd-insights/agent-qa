// THE MODELS SECTION BODY (429-23 · D-10, D-11, D-17, WIN #133 · UI-SPEC S4, E1, E4).
//
// Every saved model is one row in file order. The list waits for the credential-status read, and
// a failed read shows every row Not connected: a status the page has not read is never claimed.
// Add model sits in the section's heading row; with no models the empty state holds the only one.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Plus, TriangleAlert } from "lucide-react"

import { ModelRow, modelStatus, providerFacts, type SavedModel } from "@/components/config-manager/model-row"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfigAutosaveContext, type ConfigFieldRef } from "@/hooks/use-config-autosave"
import { fetchAuthStatus, fetchLLMProviders, type AuthCredentialInfo, type LLMProviderMetadata } from "@/lib/api"
import { ADD_MODEL_LABEL, NO_DEFAULT_TEXT, NO_MODELS_TEXT } from "@/lib/config-copy"
import { configTabPath } from "@/lib/config-tabs"

interface ModelListProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

interface WorkspaceReads {
  credentials: readonly AuthCredentialInfo[]
  providers: readonly LLMProviderMetadata[]
}

const LLMS_REF: ConfigFieldRef = { segments: ["registry", "llms"], tab: "models" }
const DEFAULT_REF: ConfigFieldRef = { segments: ["use", "llm"], tab: "models" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function savedModels(value: unknown): SavedModel[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is SavedModel =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.provider === "string" &&
      typeof entry.model === "string",
  )
}

export function ModelList(_props: ModelListProps) {
  const autosave = useConfigAutosaveContext()
  const navigate = useNavigate()
  const [reads, setReads] = useState<WorkspaceReads | undefined>(undefined)
  const [openName, setOpenName] = useState<string | undefined>(undefined)
  const models = savedModels(autosave.valueOf(LLMS_REF))
  const defaultValue = autosave.valueOf(DEFAULT_REF)
  const defaultName = typeof defaultValue === "string" ? defaultValue : undefined
  const hasDefault = models.some((model) => model.name === defaultName)

  useEffect(() => {
    let active = true
    void Promise.all([
      fetchAuthStatus().then(
        (answer) => answer.credentials ?? [],
        () => [],
      ),
      fetchLLMProviders().then(
        (answer) => answer.providers ?? [],
        () => [],
      ),
    ]).then(([credentials, providers]) => {
      if (active) setReads({ credentials, providers })
    })
    return () => {
      active = false
    }
  }, [])

  function makeDefault(name: string) {
    autosave.edit(DEFAULT_REF, name, { valid: true, value: name })
    autosave.settle(DEFAULT_REF)
  }

  function addModel() {
    navigate(`${configTabPath("models")}?add`)
  }

  if (reads === undefined) {
    return (
      <div data-models-loading aria-busy="true" className="col-span-full space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div data-models-empty className="col-span-full space-y-4 rounded-md border border-border px-4 py-8">
        <p className="text-sm">{NO_MODELS_TEXT}</p>
        <Button type="button" onClick={addModel}>
          <Plus className="size-3.5" aria-hidden="true" />
          {ADD_MODEL_LABEL}
        </Button>
      </div>
    )
  }

  const now = Date.now()
  return (
    <>
      <Button type="button" variant="outline" size="sm" data-model-add className="justify-self-end" onClick={addModel}>
        <Plus className="size-3.5" aria-hidden="true" />
        {ADD_MODEL_LABEL}
      </Button>
      <div className="col-span-full space-y-4">
        {hasDefault ? null : (
          <p data-no-default className="flex items-start gap-1 text-xs text-foreground">
            <span className="flex h-[1lh] shrink-0 items-center">
              <TriangleAlert className="size-3 text-amber-500" aria-hidden="true" />
            </span>
            {NO_DEFAULT_TEXT}
          </p>
        )}
        <ul data-model-list data-field-list="registry.llms" className="divide-y divide-border rounded-md border border-border">
          {models.map((model) => (
            <ModelRow
              key={model.name}
              model={model}
              status={modelStatus(reads.credentials, model, now)}
              facts={providerFacts(reads.providers, model.provider)}
              isDefault={model.name === defaultName}
              open={openName === model.name}
              onToggle={() => setOpenName((current) => (current === model.name ? undefined : model.name))}
              onMakeDefault={() => makeDefault(model.name)}
            />
          ))}
        </ul>
      </div>
    </>
  )
}
