import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateSettings } from "@/lib/api"
import {
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSectionShell,
} from "@/components/config-manager/config-section-shell"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { parseConfigNumberInput } from "@/components/config-manager/numeric-input"

interface KnowledgeSectionProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

export function KnowledgeSection({ config, onConfigChange }: KnowledgeSectionProps) {
  const knowledge = ((config.knowledge ?? {}) as {
    dir?: string
    commitArtifacts?: string
    contextBudgetTokens?: number
  })

  const [dir, setDir] = useState(knowledge.dir ?? "agent-qa-knowledge")
  const [commitArtifacts, setCommitArtifacts] = useState(knowledge.commitArtifacts ?? "none")
  const [contextBudgetTokens, setContextBudgetTokens] = useState(
    knowledge.contextBudgetTokens !== undefined ? String(knowledge.contextBudgetTokens) : "",
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const trimmedDir = dir.trim()
    if (!trimmedDir) {
      toast.error("Knowledge directory is required")
      return
    }
    let parsedBudget: number | undefined
    if (contextBudgetTokens.trim().length > 0) {
      const parsed = parseConfigNumberInput(contextBudgetTokens, {
        label: "Context budget tokens",
        min: 1,
        integer: true,
      })
      if (parsed.error) {
        toast.error(parsed.error)
        return
      }
      parsedBudget = parsed.value
    }

    setSaving(true)
    try {
      await updateSettings({
        'knowledge': {
          dir: trimmedDir,
          commitArtifacts,
          ...(parsedBudget !== undefined ? { contextBudgetTokens: parsedBudget } : {}),
        },
      })
      onConfigChange()
      toast.success("Changes saved")
    } catch {
      toast.error("Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigSectionShell>
      <ConfigSectionHeader>
        <h2 className="text-base font-semibold">Knowledge</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configure the repo-relative knowledge root, artifact commit policy, and the optional serving context budget.</p>
      </ConfigSectionHeader>
      <ConfigSectionBody>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="knowledge-dir">Knowledge Directory</Label>
            <Input
              id="knowledge-dir"
              placeholder="agent-qa-knowledge"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Repo-relative path. Absolute paths and parent-directory escapes are rejected.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="knowledge-commit-artifacts">Commit Artifacts</Label>
            <Select value={commitArtifacts} onValueChange={setCommitArtifacts}>
              <SelectTrigger id="knowledge-commit-artifacts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="thumbnails">Thumbnails</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="knowledge-context-budget">Context Budget Tokens</Label>
            <Input
              id="knowledge-context-budget"
              type="number"
              min="1"
              placeholder="no cap"
              value={contextBudgetTokens}
              onChange={(e) => setContextBudgetTokens(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Optional. Leave empty for no cap — serving optimizes for run efficacy, not token savings.</p>
          </div>
        </div>

        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save Changes"}
        </Button>
      </ConfigSectionBody>
    </ConfigSectionShell>
  )
}
