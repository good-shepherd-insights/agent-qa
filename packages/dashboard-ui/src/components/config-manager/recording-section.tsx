import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSectionShell,
} from '@/components/config-manager/config-section-shell'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { updateSettings } from '@/lib/api'

export const RECORDING_SECTION_DESCRIPTION =
  'Every run records video by default so each run opens with the same player. Turn it off here.'
export const RECORDING_ENABLED_HELP =
  'Record video of each test. Recordings stay on this machine.'
export const RECORDING_KEEP_FAILURES_LABEL = 'Keep recordings of failed tests only'
export const RECORDING_KEEP_FAILURES_HELP =
  'Useful for CI and large suites. Passed tests then open on Frames.'

interface RecordingSectionProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

interface AuthoredRecording {
  enabled?: boolean
  keepFailuresOnly?: boolean
}

export function RecordingSection({ config, onConfigChange }: RecordingSectionProps) {
  const recording = (config.services as { recording?: AuthoredRecording } | undefined)?.recording
  // Keep the authored values distinct from their displayed runtime defaults.
  const [enabled, setEnabled] = useState(recording?.enabled)
  const [keepFailuresOnly, setKeepFailuresOnly] = useState(recording?.keepFailuresOnly)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const value = {
        ...(enabled === undefined ? {} : { enabled }),
        ...(keepFailuresOnly === undefined ? {} : { keepFailuresOnly }),
      }
      await updateSettings(
        recording === undefined && Object.keys(value).length === 0
          ? {}
          : { 'services.recording': value },
      )
      onConfigChange()
      toast.success('Changes saved')
    } catch {
      toast.error('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigSectionShell>
      <ConfigSectionHeader>
        <h2 className="text-base font-semibold">Recording</h2>
        <p className="text-sm text-muted-foreground">{RECORDING_SECTION_DESCRIPTION}</p>
      </ConfigSectionHeader>
      <ConfigSectionBody>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="recording-enabled">Enabled</Label>
            <p className="text-xs text-muted-foreground">{RECORDING_ENABLED_HELP}</p>
          </div>
          <Switch id="recording-enabled" checked={enabled ?? true} onCheckedChange={setEnabled} />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="recording-keep-failures-only">{RECORDING_KEEP_FAILURES_LABEL}</Label>
            <p className="text-xs text-muted-foreground">{RECORDING_KEEP_FAILURES_HELP}</p>
          </div>
          <Switch
            id="recording-keep-failures-only"
            checked={keepFailuresOnly ?? false}
            onCheckedChange={setKeepFailuresOnly}
          />
        </div>

        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save Changes'}
        </Button>
      </ConfigSectionBody>
    </ConfigSectionShell>
  )
}
