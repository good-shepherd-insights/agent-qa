// DEVICE FARMS (429-19 · D-08, D-09, D-23, D-24 · UI-SPEC S8 "Device farms", E8).
//
// Each farm lists its settings key by key and every value is a SecretValue: shown as the server
// sent it (through the declared mask only, 441-40 D-29), replaced explicitly. New settings and farms
// are typed into component state only and saved with an explicit button; deleting a farm acts at
// once and offers Undo.

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { ConfigChange } from "@vostride/agent-qa-schema"

import { SecretValue } from "@/components/config-manager/secret-value"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfigAutosaveContext } from "@/hooks/use-config-autosave"
import {
  ADD_DEVICE_FARM_LABEL,
  ADD_SETTING_LABEL,
  DEVICE_FARM_FIELD_LABELS,
  DISCARD_SETTING_LABEL,
  NO_DEVICE_FARMS_TEXT,
  SAVE_SETTING_LABEL,
  deleteActionName,
  deviceFarmSettingLabel,
} from "@/lib/config-copy"

interface ProvidersSectionProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

const SETTING_PATTERN = "registry.providers.*.*"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function farmsOf(config: Record<string, unknown>): [string, Record<string, unknown>][] {
  const registry = config.registry
  const providers = isRecord(registry) ? registry.providers : undefined
  if (!isRecord(providers)) return []
  return Object.entries(providers).map(([name, settings]) => [name, isRecord(settings) ? settings : {}])
}

function maskedTextOf(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

export function ProvidersSection({ config }: ProvidersSectionProps) {
  const autosave = useConfigAutosaveContext()
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const addFarmButton = useRef<HTMLButtonElement>(null)
  const focusAddFarmNext = useRef(false)

  useEffect(() => {
    if (!adding && focusAddFarmNext.current) {
      focusAddFarmNext.current = false
      addFarmButton.current?.focus()
    }
  }, [adding])

  const farms = farmsOf(config).filter(([name]) => !removing.has(name))
  const names = new Set(farmsOf(config).map(([name]) => name))

  function focusAfterRemoving(name: string) {
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[]
    const index = rows.findIndex((row) => row.dataset.deviceFarm === name)
    const neighbour = rows[index + 1] ?? rows[index - 1]
    const target = neighbour?.querySelector("button") ?? addFarmButton.current
    target?.focus()
  }

  async function deleteFarm(name: string) {
    focusAfterRemoving(name)
    setRemoving((current) => new Set(current).add(name))
    await autosave.runExplicit([{ op: "unset", path: ["registry", "providers", name] }], {
      kind: "delete-device-farm",
      name,
    })
    setRemoving((current) => {
      const next = new Set(current)
      next.delete(name)
      return next
    })
  }

  function closeAddFarm() {
    focusAddFarmNext.current = true
    setAdding(false)
  }

  return (
    <div data-field-list="registry.providers" className="space-y-3">
      {farms.length > 0 ? (
        <ul ref={listRef} className="divide-y divide-border">
          {farms.map(([name, settings]) => (
            <li key={name} data-device-farm={name} className="space-y-2 py-3 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">{name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={deleteActionName("delete-device-farm", name)}
                  className="hover:text-destructive"
                  onClick={() => void deleteFarm(name)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              {Object.keys(settings).length > 0 ? (
                <dl className="space-y-2">
                  {Object.entries(settings).map(([key, value]) => (
                    <div key={key} className="grid items-center gap-1 sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-3">
                      <dt className="font-mono text-xs text-muted-foreground wrap-anywhere">{key}</dt>
                      <dd>
                        <SecretValue
                          field={{ segments: ["registry", "providers", name, key], pattern: SETTING_PATTERN }}
                          label={deviceFarmSettingLabel(name, key)}
                          maskedText={maskedTextOf(value)}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <AddSetting farm={name} existingKeys={Object.keys(settings)} />
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? <AddFarm takenNames={names} onClose={closeAddFarm} /> : null}
      {adding ? null : (
        <div className="flex flex-wrap items-center gap-3">
          {farms.length === 0 ? <p className="text-sm text-muted-foreground">{NO_DEVICE_FARMS_TEXT}</p> : null}
          <Button ref={addFarmButton} type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            {ADD_DEVICE_FARM_LABEL}
          </Button>
        </div>
      )}
    </div>
  )
}

interface SettingDraft {
  key: string
  value: string
}

const EMPTY_SETTING: SettingDraft = { key: "", value: "" }

/** A key and a password value, typed into component state only and saved with an explicit button. */
function SettingInputs({
  draft,
  onChange,
  onSave,
  onDiscard,
  autoFocus,
}: {
  draft: SettingDraft
  onChange: (next: SettingDraft) => void
  onSave: () => void
  onDiscard: () => void
  autoFocus: boolean
}) {
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      onSave()
    } else if (event.key === "Escape") {
      event.preventDefault()
      onDiscard()
    }
  }

  return (
    <div className="flex max-w-md flex-wrap items-center gap-1">
      <Input
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={DEVICE_FARM_FIELD_LABELS.key}
        placeholder={DEVICE_FARM_FIELD_LABELS.key}
        value={draft.key}
        onChange={(event) => onChange({ ...draft, key: event.target.value })}
        onKeyDown={keyDown}
        className="h-8 w-36 font-mono"
      />
      <Input
        type="password"
        autoComplete="off"
        aria-label={DEVICE_FARM_FIELD_LABELS.value}
        placeholder={DEVICE_FARM_FIELD_LABELS.value}
        value={draft.value}
        onChange={(event) => onChange({ ...draft, value: event.target.value })}
        onKeyDown={keyDown}
        className="h-8 min-w-0 flex-1 font-mono"
      />
    </div>
  )
}

function AddSetting({ farm, existingKeys }: { farm: string; existingKeys: readonly string[] }) {
  const autosave = useConfigAutosaveContext()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SettingDraft>(EMPTY_SETTING)
  const [saving, setSaving] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAddNext = useRef(false)
  const key = draft.key.trim()
  const ready = key !== "" && draft.value !== "" && !existingKeys.includes(key)

  useEffect(() => {
    if (!open && focusAddNext.current) {
      focusAddNext.current = false
      addButton.current?.focus()
    }
  }, [open])

  function close() {
    setDraft(EMPTY_SETTING)
    focusAddNext.current = true
    setOpen(false)
  }

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    const change: ConfigChange = { op: "set", path: ["registry", "providers", farm, key], value: draft.value }
    const landed = await autosave.runExplicit([change])
    setSaving(false)
    if (landed) close()
  }

  if (!open) {
    return (
      <Button ref={addButton} type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Plus className="size-3" aria-hidden="true" />
        {ADD_SETTING_LABEL}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <SettingInputs draft={draft} onChange={setDraft} onSave={() => void save()} onDiscard={close} autoFocus />
      <Button type="button" variant="outline" size="sm" disabled={!ready || saving} onClick={() => void save()}>
        {SAVE_SETTING_LABEL}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={close}>
        {DISCARD_SETTING_LABEL}
      </Button>
    </div>
  )
}

function AddFarm({ takenNames, onClose }: { takenNames: ReadonlySet<string>; onClose: () => void }) {
  const autosave = useConfigAutosaveContext()
  const [name, setName] = useState("")
  const [draft, setDraft] = useState<SettingDraft>(EMPTY_SETTING)
  const [saving, setSaving] = useState(false)
  const farm = name.trim()
  const key = draft.key.trim()
  const ready = farm !== "" && !takenNames.has(farm) && key !== "" && draft.value !== ""

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    const change: ConfigChange = { op: "set", path: ["registry", "providers", farm], value: { [key]: draft.value } }
    const landed = await autosave.runExplicit([change])
    setSaving(false)
    if (landed) onClose()
  }

  return (
    <div data-device-farm-draft className="space-y-2">
      <Input
        type="text"
        autoComplete="off"
        autoFocus
        aria-label={DEVICE_FARM_FIELD_LABELS.name}
        placeholder={DEVICE_FARM_FIELD_LABELS.name}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
        className="h-8 max-w-xs font-mono"
      />
      <div className="flex flex-wrap items-center gap-1">
        <SettingInputs draft={draft} onChange={setDraft} onSave={() => void save()} onDiscard={onClose} autoFocus={false} />
        <Button type="button" variant="outline" size="sm" disabled={!ready || saving} onClick={() => void save()}>
          {SAVE_SETTING_LABEL}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {DISCARD_SETTING_LABEL}
        </Button>
      </div>
    </div>
  )
}
