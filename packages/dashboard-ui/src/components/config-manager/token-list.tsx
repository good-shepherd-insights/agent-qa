// ACCESS TOKENS (429-27 · D-05, D-06, D-08, D-23, D-24 · research A7 · UI-SPEC S7, E9).
//
// MCP access tokens and run-service tokens: each row shows the token's name and the NAME of the
// environment variable holding it, in clear; the value never reaches the page. Add token opens an
// inline draft row asking for what the schema requires (a scope for an MCP token, an optional
// trust scope for a run-service token) and writes one append when the row settles (focus leaves it
// or Enter in a text field). Delete acts at once and offers Undo.

import { useEffect, useId, useRef, useState, type FocusEvent } from "react"
import { CircleAlert, Plus, Trash2 } from "lucide-react"
import { FunctionScopeSchema, TRUST_SCOPE_KEYS, type ConfigPathSegment, type FunctionScope } from "@vostride/agent-qa-schema"

import { DraftTextField, leavesGroup, useHeldDraft } from "@/components/config-manager/record-list"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  configFieldControlId,
  configFieldKeyOf,
  useConfigAutosaveContext,
  type ConfigFieldRef,
} from "@/hooks/use-config-autosave"
import {
  ACCESS_TOKENS_HEADING,
  ADD_TOKEN_LABEL,
  DISCARD_TOKEN_LABEL,
  FUNCTION_SCOPE_LABELS,
  NO_TOKENS_TEXT,
  SCOPES_LABEL,
  SCOPE_REQUIRED_ERROR,
  TOKEN_ENV_VAR_REQUIRED_ERROR,
  TOKEN_FIELD_LABELS,
  TOKEN_NAME_REQUIRED_ERROR,
  TRUST_SCOPE_HELP,
  TRUST_SCOPE_LABELS,
  TRUST_SCOPE_LEGEND,
  deleteActionName,
  tokenEnvLine,
  tokenNameTakenError,
} from "@/lib/config-copy"

export type TokenKind = "mcp" | "run-service"

export interface TokenListProps {
  kind: TokenKind
  config: Record<string, unknown>
}

interface TokenEntry {
  name: string
  tokenEnvVar: string
}

const KINDS = {
  mcp: {
    segments: ["services", "mcp", "tokens"],
    pattern: "services.mcp.tokens",
    deleteKind: "delete-mcp-token",
  },
  "run-service": {
    segments: ["services", "dashboard", "runServiceTokens"],
    pattern: "services.dashboard.runServiceTokens",
    deleteKind: "delete-run-service-token",
  },
} as const satisfies Record<TokenKind, { segments: readonly string[]; pattern: string; deleteKind: string }>

const SCOPES: readonly FunctionScope[] = FunctionScopeSchema.options

function listRefOf(kind: TokenKind): ConfigFieldRef {
  return { segments: KINDS[kind].segments, tab: "advanced" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tokensOf(config: Record<string, unknown>, segments: readonly string[]): TokenEntry[] {
  let node: unknown = config
  for (const segment of segments) node = isRecord(node) ? node[segment] : undefined
  if (!Array.isArray(node)) return []
  return node.flatMap((entry) =>
    isRecord(entry) && typeof entry.name === "string"
      ? [{ name: entry.name, tokenEnvVar: typeof entry.tokenEnvVar === "string" ? entry.tokenEnvVar : "" }]
      : [],
  )
}

function deleteButtonsIn(list: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(list?.querySelectorAll<HTMLButtonElement>("[data-token-row] [data-token-delete]") ?? [])
}

function deleteButtonOf(list: HTMLElement | null, name: string): HTMLButtonElement | undefined {
  return deleteButtonsIn(list).find((button) => button.closest("[data-token-row]")?.getAttribute("data-token-name") === name)
}

export function TokenList({ kind, config }: TokenListProps) {
  const autosave = useConfigAutosaveContext()
  const { segments, pattern, deleteKind } = KINDS[kind]
  const listRef = listRefOf(kind)
  const held = useHeldDraft(listRef, EMPTY_DRAFT)
  const [adding, setAdding] = useState(() => held.restored !== undefined)
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const list = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAddNext = useRef(false)
  const restored = autosave.restored
  // An Undo from before this list mounted (a tab change since) never moves focus.
  const seenSeq = useRef(restored?.seq)
  const all = tokensOf(config, segments)
  const tokens = all.filter((token) => !removing.has(token.name))

  useEffect(() => {
    if (!adding && focusAddNext.current) {
      focusAddNext.current = false
      addButton.current?.focus()
    }
  }, [adding])

  useEffect(() => {
    if (restored === undefined || restored.seq === seenSeq.current) return
    seenSeq.current = restored.seq
    if (restored.kind === deleteKind) deleteButtonOf(list.current, restored.name)?.focus()
  }, [restored, deleteKind])

  async function remove(name: string) {
    const buttons = deleteButtonsIn(list.current)
    const index = buttons.findIndex((button) => button.closest("[data-token-row]")?.getAttribute("data-token-name") === name)
    ;(buttons[index + 1] ?? buttons[index - 1] ?? addButton.current)?.focus()
    setRemoving((current) => new Set(current).add(name))
    const path: ConfigPathSegment[] = [...segments, { name }]
    await autosave.runExplicit([{ op: "unset", path }], { kind: deleteKind, name })
    setRemoving((current) => {
      const next = new Set(current)
      next.delete(name)
      return next
    })
  }

  function closeDraft() {
    focusAddNext.current = true
    setAdding(false)
  }

  return (
    <div className="space-y-3">
      {kind === "mcp" ? <h3 className="text-sm font-medium">{ACCESS_TOKENS_HEADING}</h3> : null}
      <div ref={list} data-field-list={pattern} className="space-y-3">
        {tokens.length > 0 ? (
          <ul className="divide-y divide-border">
            {tokens.map((token) => (
              <TokenRow
                key={token.name}
                token={token}
                deleteName={deleteActionName(deleteKind, token.name)}
                onDelete={() => void remove(token.name)}
              />
            ))}
          </ul>
        ) : null}
        {adding ? (
          <AddTokenRow
            kind={kind}
            initial={held.restored ?? EMPTY_DRAFT}
            takenNames={new Set(all.map((token) => token.name))}
            onHold={held.hold}
            onDiscard={() => {
              held.discard()
              closeDraft()
            }}
            onAdded={closeDraft}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {tokens.length === 0 ? <p className="text-sm text-muted-foreground">{NO_TOKENS_TEXT}</p> : null}
            <Button ref={addButton} type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              {ADD_TOKEN_LABEL}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function TokenRow({ token, deleteName, onDelete }: { token: TokenEntry; deleteName: string; onDelete: () => void }) {
  const line = tokenEnvLine(token.tokenEnvVar)
  const prefix = line.slice(0, line.length - token.tokenEnvVar.length)
  return (
    <li data-token-row data-token-name={token.name} className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-mono text-sm font-medium wrap-anywhere">{token.name}</p>
        <p className="text-xs text-muted-foreground wrap-anywhere">
          {prefix}
          <span className="font-mono wrap-anywhere">{token.tokenEnvVar}</span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-token-delete
        aria-label={deleteName}
        className="shrink-0 hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </li>
  )
}

interface TokenDraft extends Record<string, string> {
  name: string
  tokenEnvVar: string
  /** Checked scopes, comma-joined, so the draft stays a flat record of strings. */
  scopes: string
  project: string
  org: string
}

type DraftKey = "name" | "tokenEnvVar" | "project" | "org"
type DraftError = "name" | "tokenEnvVar" | "scopes"

const EMPTY_DRAFT: TokenDraft = { name: "", tokenEnvVar: "", scopes: "", project: "", org: "" }

function scopesOf(draft: TokenDraft): FunctionScope[] {
  const checked = new Set(draft.scopes.split(","))
  return SCOPES.filter((scope) => checked.has(scope))
}

function draftErrors(kind: TokenKind, draft: TokenDraft, takenNames: ReadonlySet<string>): Partial<Record<DraftError, string>> {
  const errors: Partial<Record<DraftError, string>> = {}
  const name = draft.name.trim()
  if (name === "") errors.name = TOKEN_NAME_REQUIRED_ERROR
  else if (takenNames.has(name)) errors.name = tokenNameTakenError(name)
  if (draft.tokenEnvVar.trim() === "") errors.tokenEnvVar = TOKEN_ENV_VAR_REQUIRED_ERROR
  if (kind === "mcp" && scopesOf(draft).length === 0) errors.scopes = SCOPE_REQUIRED_ERROR
  return errors
}

function draftValue(kind: TokenKind, draft: TokenDraft): Record<string, unknown> {
  const base = { name: draft.name.trim(), tokenEnvVar: draft.tokenEnvVar.trim() }
  if (kind === "mcp") return { ...base, scopes: scopesOf(draft) }
  // An empty trust-scope field is left out: the schema refuses an empty string there.
  const trustScope = Object.fromEntries(
    TRUST_SCOPE_KEYS.filter((key) => draft[key].trim() !== "").map((key) => [key, draft[key].trim()]),
  )
  return { ...base, trustScope }
}

interface AddTokenRowProps {
  kind: TokenKind
  initial: TokenDraft
  takenNames: ReadonlySet<string>
  onHold: (draft: TokenDraft) => void
  onDiscard: () => void
  onAdded: () => void
}

function AddTokenRow({ kind, initial, takenNames, onHold, onDiscard, onAdded }: AddTokenRowProps) {
  const autosave = useConfigAutosaveContext()
  const listRef = listRefOf(kind)
  const [draft, setDraft] = useState(initial)
  const [touched, setTouched] = useState(false)
  const saving = useRef(false)
  const [locked, setLocked] = useState(false)
  const baseId = useId()
  const errors = touched ? draftErrors(kind, draft, takenNames) : {}
  const checked = new Set(scopesOf(draft))
  const scopesErrorId = `${baseId}-scopes-error`

  useEffect(() => {
    onHold(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function change(next: TokenDraft) {
    setDraft(next)
    onHold(next)
  }

  async function settle(current: TokenDraft, markTouched: boolean) {
    if (markTouched) setTouched(true)
    if (saving.current || Object.keys(draftErrors(kind, current, takenNames)).length > 0) return
    saving.current = true
    setLocked(true)
    const landed = await autosave.runExplicit(
      [{ op: "append", path: [...listRef.segments], value: draftValue(kind, current) }],
      undefined,
      [listRef],
    )
    saving.current = false
    setLocked(false)
    if (landed) onAdded()
  }

  // A scope composes the unsaved entry like its text fields: it settles with the row, never alone.
  function toggleScope(scope: FunctionScope, on: boolean) {
    const next = new Set(checked)
    if (on) next.add(scope)
    else next.delete(scope)
    change({ ...draft, scopes: SCOPES.filter((item) => next.has(item)).join(",") })
  }

  function leave(event: FocusEvent<HTMLDivElement>) {
    if (leavesGroup(event)) void settle(draft, true)
  }

  const text = (key: DraftKey, label: string, placeholder: string, extra: { autoFocus?: boolean; id?: string; mono?: boolean; error?: string } = {}) => (
    <DraftTextField
      id={extra.id ?? `${baseId}-${key}`}
      name={key}
      label={label}
      value={draft[key]}
      placeholder={placeholder}
      mono={extra.mono}
      autoFocus={extra.autoFocus}
      error={extra.error}
      onChange={(value) => change({ ...draft, [key]: value })}
      onEnter={() => void settle(draft, true)}
    />
  )

  return (
    <div data-token-draft onBlur={leave} className="space-y-4 border-t border-border pt-3">
      {text("name", TOKEN_FIELD_LABELS.name, kind === "mcp" ? "claude-desktop" : "ci", {
        autoFocus: true,
        id: configFieldControlId(configFieldKeyOf(listRef.segments)),
        mono: true,
        error: errors.name,
      })}
      {text("tokenEnvVar", TOKEN_FIELD_LABELS.envVar, kind === "mcp" ? "AGENT_QA_MCP_TOKEN" : "AGENT_QA_RUN_TOKEN", {
        mono: true,
        error: errors.tokenEnvVar,
      })}
      {kind === "mcp" ? (
        <fieldset
          className="space-y-2"
          aria-invalid={errors.scopes === undefined ? undefined : true}
          aria-describedby={errors.scopes === undefined ? undefined : scopesErrorId}
        >
          <legend className="text-sm font-medium">{SCOPES_LABEL}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((scope) => {
              const id = `${baseId}-scope-${scope}`
              return (
                <div key={scope} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    data-scope={scope}
                    checked={checked.has(scope)}
                    disabled={locked}
                    onCheckedChange={(next) => toggleScope(scope, next === true)}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {FUNCTION_SCOPE_LABELS[scope]}
                  </Label>
                </div>
              )
            })}
          </div>
          {errors.scopes === undefined ? null : (
            <p id={scopesErrorId} data-field-error className="flex items-start gap-1 text-xs text-destructive break-words">
              <span className="flex h-[1lh] shrink-0 items-center">
                <CircleAlert className="size-3" aria-hidden="true" />
              </span>
              {errors.scopes}
            </p>
          )}
        </fieldset>
      ) : (
        <fieldset className="space-y-2" aria-describedby={`${baseId}-trust-help`}>
          <legend className="text-sm font-medium">{TRUST_SCOPE_LEGEND}</legend>
          <p id={`${baseId}-trust-help`} className="text-xs text-muted-foreground break-words">
            {TRUST_SCOPE_HELP}
          </p>
          <div className="space-y-4 pt-2">
            {TRUST_SCOPE_KEYS.map((key) => (
              <div key={key}>{text(key, TRUST_SCOPE_LABELS[key], key === "project" ? "acme-web" : "acme")}</div>
            ))}
          </div>
        </fieldset>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
        {DISCARD_TOKEN_LABEL}
      </Button>
    </div>
  )
}
