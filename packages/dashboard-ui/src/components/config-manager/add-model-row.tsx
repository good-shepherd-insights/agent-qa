// THE ADD ROW (429-25 · D-13, D-14, D-15, D-17, research A8 · UI-SPEC S5, E5 · PXH-CONF-03).
//
// How you connect comes first, then only that choice's fields, then the name, then Connect. The
// connect door tests the draft with the typed credential and writes it only on a pass, or on the
// explicit Save without testing a failure offers; this row never writes the config itself. The
// typed key and header values live in this component's state only; every other field persists in
// the add-row draft store, so a reload restores the row with its secrets empty.

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { CircleAlert, LoaderCircle, Plus } from "lucide-react"

import { providerFacts } from "@/components/config-manager/model-row"
import { ConnectionLine } from "@/components/config-manager/connection-line"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useConfigAutosaveContext } from "@/hooks/use-config-autosave"
import {
  clearAddModelDraft,
  readAddModelDraft,
  suggestModelName,
  writeAddModelDraft,
  type AddModelDraft,
  type AddModelKeyType,
} from "@/lib/add-model-draft"
import {
  connectLLM,
  fetchLiveModelCatalog,
  fetchModelCatalog,
  type LLMProviderMetadata,
  type ModelCatalogEntry,
} from "@/lib/api"
import {
  ADD_FLOW_FIELD_LABELS,
  ADD_HEADER_LABEL,
  BASE_URL_HELP,
  BASE_URL_REQUIRED_ERROR,
  CONNECTING_LABEL,
  CONNECTION_CHOICE_HINTS,
  CONNECTION_CHOICE_LABELS,
  CONNECT_FORM_LEGEND,
  CONNECT_LABEL,
  DISCARD_DRAFT_LABEL,
  DISCARD_HEADER_LABEL,
  HEADER_FIELD_LABELS,
  KEY_OPTIONAL_HELP,
  KEY_REQUIRED_ERROR,
  KEY_TYPE_LABELS,
  MODEL_REQUIRED_ERROR,
  NAME_RULE_ERROR,
  NEW_MODEL_ROW_TITLE,
  SAVE_WITHOUT_TESTING_LABEL,
  nameTakenError,
  providerErrorSentence,
  signInPluginMissingText,
} from "@/lib/config-copy"
import {
  CONNECTION_CHOICES,
  CONNECTION_CHOICE_PROVIDERS,
  type ConnectionChoice,
  type TestResult,
} from "@/lib/config-tabs"
import { cn } from "@/lib/utils"

const NAME_RULE = /^[a-z0-9][a-z0-9.-]*$/

/** D-13: the name rule, then a model already holding the name. */
export function validateModelName(name: string, existingNames: readonly string[]): string | undefined {
  if (!NAME_RULE.test(name)) return NAME_RULE_ERROR
  if (existingNames.includes(name)) return nameTakenError(name)
  return undefined
}

export type AddState = "choosing" | "editing" | "connecting" | "signing-in" | "failed"

/** What the list shows once the draft is saved: the new row, open, with its line. */
export interface AddModelLanding {
  name: string
  becameDefault: boolean
  withoutTest: boolean
}

export interface AddFocusRequest {
  seq: number
  /** The connection choice, or the first field of the chosen connection (a deep link naming it). */
  target: "choice" | "field"
}

interface AddModelRowProps {
  configPath: string
  providers: readonly LLMProviderMetadata[]
  existingNames: readonly string[]
  initialChoice?: ConnectionChoice
  focusRequest?: AddFocusRequest
  onConnected: (landing: AddModelLanding) => void
  onDiscard: () => void
}

type FieldName = "baseURL" | "model" | "key" | "name"
type FieldErrors = Partial<Record<FieldName, string>>

interface HeaderDraft {
  id: number
  name: string
  value: string
}

interface Line {
  state: TestResult
  sentence?: string
}

const SIGN_IN_CHOICES: readonly ConnectionChoice[] = ["chatgpt-sign-in", "claude-sign-in"]

function isSignIn(choice: ConnectionChoice | undefined): boolean {
  return choice !== undefined && SIGN_IN_CHOICES.includes(choice)
}

function providerOf(choice: ConnectionChoice): string {
  return CONNECTION_CHOICE_PROVIDERS[choice]
}

function defaultModelOf(providers: readonly LLMProviderMetadata[], choice: ConnectionChoice): string {
  if (!isSignIn(choice)) return ""
  return providers.find((provider) => provider.id === providerOf(choice))?.defaultModel ?? ""
}

function mergeCatalog(...lists: readonly (readonly ModelCatalogEntry[])[]): ModelCatalogEntry[] {
  const seen = new Set<string>()
  const merged: ModelCatalogEntry[] = []
  for (const entry of lists.flat()) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    merged.push(entry)
  }
  return merged
}

interface Initial {
  draft: AddModelDraft
  headers: HeaderDraft[]
}

function initialState(
  stored: AddModelDraft | undefined,
  initialChoice: ConnectionChoice | undefined,
  providers: readonly LLMProviderMetadata[],
): Initial {
  if (initialChoice !== undefined && stored?.choice !== initialChoice) {
    const model = defaultModelOf(providers, initialChoice)
    return { draft: { choice: initialChoice, model, name: suggestModelName(model), nameEdited: false }, headers: [] }
  }
  const draft = stored ?? {}
  const headers = (draft.headerNames ?? []).map((name, index) => ({ id: index + 1, name, value: "" }))
  return { draft, headers }
}

function refusalOf(error: unknown): { code?: string; message?: string } {
  const payload = (error as { payload?: Record<string, unknown> | null } | null)?.payload
  if (!payload) return {}
  return {
    ...(typeof payload.error === "string" ? { code: payload.error } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {}),
  }
}

interface DraftFieldProps {
  id: string
  name: FieldName | "keyType" | "headers"
  label: string
  help?: string
  error?: string
  pattern?: string
  children: (aria: { "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode
}

/** The ConfigField look for a draft field: label, control, help and error line, never autosaved. */
function DraftField({ id, name, label, help, error, pattern, children }: DraftFieldProps) {
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help === undefined ? null : helpId, error === undefined ? null : errorId]
    .filter((item): item is string => item !== null)
    .join(" ")
  return (
    <div
      data-add-field={name}
      data-field-path={pattern}
      data-field-state={error === undefined ? "clean" : "draft"}
      className="space-y-2"
    >
      <Label htmlFor={id}>{label}</Label>
      {children({
        ...(error === undefined ? {} : { "aria-invalid": true as const }),
        ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
      })}
      {help === undefined ? null : (
        <p id={helpId} data-field-help className="text-xs text-muted-foreground break-words">
          {help}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} data-field-error className="flex items-start gap-1 text-xs text-destructive break-words">
          <span className="flex h-[1lh] shrink-0 items-center">
            <CircleAlert className="size-3" aria-hidden="true" />
          </span>
          {error}
        </p>
      )}
    </div>
  )
}

export function AddModelRow({
  configPath,
  providers,
  existingNames,
  initialChoice,
  focusRequest,
  onConnected,
  onDiscard,
}: AddModelRowProps) {
  const autosave = useConfigAutosaveContext()
  const baseId = useId()
  const [initial] = useState(() => initialState(readAddModelDraft(configPath), initialChoice, providers))
  const [choice, setChoice] = useState<ConnectionChoice | undefined>(initial.draft.choice)
  const [baseURL, setBaseURL] = useState(initial.draft.baseURL ?? "")
  const [model, setModel] = useState(initial.draft.model ?? "")
  const [name, setName] = useState(initial.draft.name ?? "")
  const [nameEdited, setNameEdited] = useState(initial.draft.nameEdited ?? false)
  const [keyType, setKeyType] = useState<AddModelKeyType>(initial.draft.keyType ?? "api-key")
  const [headers, setHeaders] = useState<HeaderDraft[]>(initial.headers)
  const [secret, setSecret] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [connecting, setConnecting] = useState(false)
  const [line, setLine] = useState<Line | undefined>(undefined)
  const [offerSkip, setOfferSkip] = useState(false)
  const [catalog, setCatalog] = useState<Record<string, ModelCatalogEntry[]>>({})
  const [liveCatalog, setLiveCatalog] = useState<ModelCatalogEntry[]>([])
  const choiceRefs = useRef(new Map<ConnectionChoice, HTMLButtonElement>())
  const fieldRefs = useRef(new Map<FieldName, HTMLInputElement>())
  const nextHeaderId = useRef(initial.headers.length + 1)
  const mounted = useRef(true)
  const setExternalDraft = autosave.setExternalDraft

  const provider = choice === undefined ? undefined : providerOf(choice)
  const facts = provider === undefined ? undefined : providerFacts(providers, provider)
  const signIn = isSignIn(choice)
  const pluginMissing = signIn && provider !== undefined && !providers.some((item) => item.id === provider)
  const keyMode = choice !== undefined && !signIn
  const needsBaseURL = keyMode && facts?.needsBaseURL === true
  const keyOptional = keyMode && facts?.keyOptional === true
  const anthropic = choice === "anthropic-compatible-key"
  const liveCapable =
    choice === "openai-compatible-key" ||
    (provider !== undefined && providers.find((item) => item.id === provider)?.modelAdapter === "openai-responses")
  const addState: AddState =
    connecting ? "connecting" : line?.state === "failed" ? "failed" : choice === undefined ? "choosing" : "editing"
  const headerNames = headers.map((header) => header.name)
  const headerNamesKey = JSON.stringify(headerNames)
  const suggestions = mergeCatalog(provider === undefined ? [] : (catalog[provider] ?? []), liveCatalog)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    setExternalDraft("models", true)
    return () => setExternalDraft("models", false)
  }, [setExternalDraft])

  useEffect(() => {
    let active = true
    fetchModelCatalog().then(
      (answer) => {
        if (active) setCatalog(answer.catalog ?? {})
      },
      () => {
        // Suggestions are optional; the field takes any model id.
      },
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    writeAddModelDraft(configPath, {
      ...(choice === undefined ? {} : { choice }),
      baseURL,
      model,
      name,
      nameEdited,
      keyType,
      headerNames: JSON.parse(headerNamesKey) as string[],
    })
  }, [configPath, choice, baseURL, model, name, nameEdited, keyType, headerNamesKey])

  useEffect(() => {
    if (focusRequest === undefined) return
    if (focusRequest.target === "field" && choice !== undefined) {
      const first = (["baseURL", "model", "key", "name"] as const).map((field) => fieldRefs.current.get(field)).find(Boolean)
      if (first) {
        first.focus()
        return
      }
    }
    const target = (choice === undefined ? undefined : choiceRefs.current.get(choice)) ?? choiceRefs.current.get(CONNECTION_CHOICES[0])
    target?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request moves focus
  }, [focusRequest?.seq])

  function validate(field: FieldName, overrides: Partial<Record<FieldName, string>> = {}): string | undefined {
    const value = (key: FieldName, fallback: string) => overrides[key] ?? fallback
    switch (field) {
      case "baseURL":
        return needsBaseURL && value("baseURL", baseURL).trim() === "" ? BASE_URL_REQUIRED_ERROR : undefined
      case "model":
        return value("model", model).trim() === "" ? MODEL_REQUIRED_ERROR : undefined
      case "key":
        return keyMode && !keyOptional && value("key", secret) === "" ? KEY_REQUIRED_ERROR : undefined
      case "name":
        return validateModelName(value("name", name), existingNames)
    }
  }

  function showError(field: FieldName, error: string | undefined) {
    setErrors((current) => {
      if (current[field] === error) return current
      const next = { ...current }
      if (error === undefined) delete next[field]
      else next[field] = error
      return next
    })
  }

  /** A field that already shows an error re-checks as it changes, so the error leaves once fixed. */
  function recheck(field: FieldName, raw: string) {
    if (errors[field] !== undefined) showError(field, validate(field, { [field]: raw }))
  }

  function changeChoice(value: string) {
    const next = CONNECTION_CHOICES.find((item) => item === value)
    if (next === undefined || next === choice || connecting) return
    const nextModel = defaultModelOf(providers, next)
    setChoice(next)
    setBaseURL("")
    setModel(nextModel)
    setSecret("")
    setKeyType("api-key")
    setHeaders([])
    setLiveCatalog([])
    setErrors({})
    setLine(undefined)
    setOfferSkip(false)
    if (!nameEdited) setName(suggestModelName(nextModel))
  }

  function changeModel(raw: string) {
    setModel(raw)
    recheck("model", raw)
    if (!nameEdited) {
      const suggested = suggestModelName(raw)
      setName(suggested)
      if (errors.name !== undefined) showError("name", validate("name", { name: suggested }))
    }
  }

  function changeName(raw: string) {
    setName(raw)
    setNameEdited(true)
    recheck("name", raw)
  }

  function sendableHeaders(): Record<string, string> | undefined {
    if (!anthropic) return undefined
    const entries = headers
      .map((header) => [header.name.trim(), header.value] as const)
      .filter(([key, value]) => key !== "" && value !== "")
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  async function loadLiveModels() {
    const url = baseURL.trim()
    if (!liveCapable || url === "") return
    try {
      const answer = await fetchLiveModelCatalog({ baseURL: url })
      if (mounted.current) setLiveCatalog(answer.models ?? [])
    } catch {
      // The catalog suggestions stay when the endpoint can't list its models.
    }
  }

  async function connect(skipTest: boolean) {
    if (connecting || choice === undefined || provider === undefined) return
    const order: FieldName[] = ["baseURL", "model", "key", "name"]
    const found: FieldErrors = {}
    for (const field of order) {
      const error = validate(field)
      if (error !== undefined) found[field] = error
    }
    setErrors(found)
    const firstInvalid = order.find((field) => found[field] !== undefined)
    if (firstInvalid !== undefined) {
      fieldRefs.current.get(firstInvalid)?.focus()
      return
    }
    const providerHeaders = sendableHeaders()
    const request = {
      name,
      provider,
      model: model.trim(),
      ...(needsBaseURL || baseURL.trim() !== "" ? { baseURL: baseURL.trim() } : {}),
      ...(providerHeaders ? { providerHeaders } : {}),
      ...(keyMode && secret !== "" ? { credential: { type: anthropic ? keyType : "api-key", secret } } : {}),
      ...(skipTest ? { skipTest: true } : {}),
    }
    setConnecting(true)
    setLine(skipTest ? undefined : { state: "testing" })
    let result: Awaited<ReturnType<typeof connectLLM>>
    try {
      result = await connectLLM(request)
    } catch (error) {
      if (!mounted.current) return
      setConnecting(false)
      const refusal = refusalOf(error)
      if (refusal.code === "name_taken" || refusal.code === "name_invalid") {
        setLine(undefined)
        showError("name", refusal.code === "name_taken" ? nameTakenError(name) : NAME_RULE_ERROR)
        fieldRefs.current.get("name")?.focus()
        return
      }
      if (refusal.code === "credential_missing") {
        setLine(undefined)
        showError("key", KEY_REQUIRED_ERROR)
        fieldRefs.current.get("key")?.focus()
        return
      }
      setLine({ state: "failed", sentence: refusal.message ?? providerErrorSentence("network_error", "") })
      return
    }
    if (!mounted.current) return
    if (result.success) {
      clearAddModelDraft(configPath)
      onConnected({ name, becameDefault: result.becameDefault, withoutTest: skipTest })
      return
    }
    setConnecting(false)
    setLine({ state: "failed", sentence: result.message })
    setOfferSkip(true)
  }

  function discard() {
    clearAddModelDraft(configPath)
    onDiscard()
  }

  function inputRef(field: FieldName) {
    return (element: HTMLInputElement | null) => {
      if (element) fieldRefs.current.set(field, element)
      else fieldRefs.current.delete(field)
    }
  }

  const keyLabel = anthropic
    ? keyType === "bearer-token"
      ? ADD_FLOW_FIELD_LABELS.token
      : ADD_FLOW_FIELD_LABELS.key
    : ADD_FLOW_FIELD_LABELS.apiKey
  const listId = `${baseId}-models`

  return (
    <li data-model-row data-model-draft data-add-state={addState}>
      <div className="grid min-h-12 grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2">
        <span className="col-start-2 text-sm font-medium">{NEW_MODEL_ROW_TITLE}</span>
        <Button type="button" variant="ghost" size="sm" data-discard-draft onClick={discard}>
          {DISCARD_DRAFT_LABEL}
        </Button>
      </div>
      <div className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 bg-muted/40 px-4 py-4">
        <div className="col-start-2 min-w-0 space-y-4">
          <fieldset data-add-step="connect" className="space-y-2">
            <legend className="text-sm font-medium">{CONNECT_FORM_LEGEND}</legend>
            <RadioGroup className="gap-2" value={choice ?? ""} onValueChange={changeChoice} disabled={connecting}>
              {CONNECTION_CHOICES.map((item) => {
                const itemId = `${baseId}-${item}`
                const hintId = `${itemId}-hint`
                return (
                  <Label key={item} htmlFor={itemId} data-connection-choice={item} className="items-start font-normal">
                    <RadioGroupItem
                      ref={(element) => {
                        if (element) choiceRefs.current.set(item, element)
                        else choiceRefs.current.delete(item)
                      }}
                      id={itemId}
                      value={item}
                      aria-describedby={hintId}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium leading-normal">{CONNECTION_CHOICE_LABELS[item]}</span>
                      <span id={hintId} className="block text-xs text-muted-foreground break-words">
                        {CONNECTION_CHOICE_HINTS[item]}
                      </span>
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          </fieldset>

          {choice === undefined ? null : (
            <>
              <div data-add-step="fields" className="space-y-4">
                {needsBaseURL ? (
                  <DraftField
                    id={`${baseId}-base-url`}
                    name="baseURL"
                    pattern="registry.llms[].baseURL"
                    label={ADD_FLOW_FIELD_LABELS.baseUrl}
                    help={BASE_URL_HELP}
                    error={errors.baseURL}
                  >
                    {(aria) => (
                      <Input
                        ref={inputRef("baseURL")}
                        id={`${baseId}-base-url`}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        placeholder={providers.find((item) => item.id === provider)?.baseURLPlaceholder}
                        readOnly={connecting}
                        value={baseURL}
                        onChange={(event) => {
                          setBaseURL(event.target.value)
                          recheck("baseURL", event.target.value)
                        }}
                        onBlur={() => {
                          showError("baseURL", validate("baseURL"))
                          void loadLiveModels()
                        }}
                        className="w-full max-w-md font-mono"
                        {...aria}
                      />
                    )}
                  </DraftField>
                ) : null}
                <DraftField
                  id={`${baseId}-model`}
                  name="model"
                  pattern="registry.llms[].model"
                  label={ADD_FLOW_FIELD_LABELS.model}
                  error={errors.model}
                >
                  {(aria) => (
                    <>
                      <Input
                        ref={inputRef("model")}
                        id={`${baseId}-model`}
                        type="text"
                        autoComplete="off"
                        list={suggestions.length > 0 ? listId : undefined}
                        readOnly={connecting}
                        value={model}
                        onChange={(event) => changeModel(event.target.value)}
                        onBlur={() => showError("model", validate("model"))}
                        className="w-full max-w-md font-mono"
                        {...aria}
                      />
                      {suggestions.length > 0 ? (
                        <datalist id={listId}>
                          {suggestions.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                        </datalist>
                      ) : null}
                    </>
                  )}
                </DraftField>
                {anthropic ? (
                  <DraftField id={`${baseId}-key-type`} name="keyType" label={ADD_FLOW_FIELD_LABELS.keyType}>
                    {() => (
                      <RadioGroup
                        id={`${baseId}-key-type`}
                        className="flex flex-wrap gap-4"
                        value={keyType}
                        disabled={connecting}
                        onValueChange={(value) => {
                          if (value === "api-key" || value === "bearer-token") setKeyType(value)
                        }}
                      >
                        {(["api-key", "bearer-token"] as const).map((type) => (
                          <Label key={type} htmlFor={`${baseId}-key-type-${type}`} className="font-normal">
                            <RadioGroupItem id={`${baseId}-key-type-${type}`} value={type} />
                            {KEY_TYPE_LABELS[type]}
                          </Label>
                        ))}
                      </RadioGroup>
                    )}
                  </DraftField>
                ) : null}
                {keyMode ? (
                  <DraftField
                    id={`${baseId}-key`}
                    name="key"
                    label={keyLabel}
                    help={keyOptional ? KEY_OPTIONAL_HELP : undefined}
                    error={errors.key}
                  >
                    {(aria) => (
                      <Input
                        ref={inputRef("key")}
                        id={`${baseId}-key`}
                        type="password"
                        autoComplete="off"
                        readOnly={connecting}
                        value={secret}
                        onChange={(event) => {
                          setSecret(event.target.value)
                          recheck("key", event.target.value)
                        }}
                        onBlur={() => showError("key", validate("key"))}
                        className="w-full max-w-md font-mono"
                        {...aria}
                      />
                    )}
                  </DraftField>
                ) : null}
                {anthropic ? (
                  <fieldset data-add-headers className="space-y-2">
                    <legend className="text-sm font-medium">{ADD_FLOW_FIELD_LABELS.headers}</legend>
                    {headers.map((header) => (
                      <div
                        key={header.id}
                        data-add-header
                        className="grid gap-2 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <Input
                          type="text"
                          aria-label={HEADER_FIELD_LABELS.name}
                          autoComplete="off"
                          readOnly={connecting}
                          value={header.name}
                          onChange={(event) =>
                            setHeaders((current) =>
                              current.map((item) => (item.id === header.id ? { ...item, name: event.target.value } : item)),
                            )
                          }
                          className="h-8 font-mono"
                        />
                        <Input
                          type="password"
                          aria-label={HEADER_FIELD_LABELS.value}
                          autoComplete="off"
                          readOnly={connecting}
                          value={header.value}
                          onChange={(event) =>
                            setHeaders((current) =>
                              current.map((item) => (item.id === header.id ? { ...item, value: event.target.value } : item)),
                            )
                          }
                          className="h-8 font-mono"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setHeaders((current) => current.filter((item) => item.id !== header.id))}
                        >
                          {DISCARD_HEADER_LABEL}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        const id = nextHeaderId.current++
                        setHeaders((current) => [...current, { id, name: "", value: "" }])
                      }}
                    >
                      <Plus className="size-3" aria-hidden="true" />
                      {ADD_HEADER_LABEL}
                    </Button>
                  </fieldset>
                ) : null}
              </div>

              <div data-add-step="name" className="space-y-4">
                <DraftField
                  id={`${baseId}-name`}
                  name="name"
                  pattern="registry.llms[].name"
                  label={ADD_FLOW_FIELD_LABELS.name}
                  error={errors.name}
                >
                  {(aria) => (
                    <Input
                      ref={inputRef("name")}
                      id={`${baseId}-name`}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      readOnly={connecting}
                      value={name}
                      onChange={(event) => changeName(event.target.value)}
                      onBlur={() => showError("name", validate("name"))}
                      className="w-full max-w-md font-mono"
                      {...aria}
                    />
                  )}
                </DraftField>
              </div>

              <div data-add-actions className="space-y-2">
                {pluginMissing ? (
                  <p data-sign-in-plugin-missing className="text-xs text-muted-foreground break-words">
                    {signInPluginMissingText(CONNECTION_CHOICE_LABELS[choice])}
                  </p>
                ) : keyMode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      data-add-connect
                      aria-disabled={connecting ? true : undefined}
                      onClick={() => void connect(false)}
                    >
                      {connecting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : null}
                      {connecting ? CONNECTING_LABEL : CONNECT_LABEL}
                    </Button>
                  </div>
                ) : null}
                {line === undefined ? null : <ConnectionLine state={line.state} sentence={line.sentence} />}
                {offerSkip && !connecting ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    data-save-without-test
                    className={cn("h-auto px-0 text-muted-foreground")}
                    onClick={() => void connect(true)}
                  >
                    {SAVE_WITHOUT_TESTING_LABEL}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
