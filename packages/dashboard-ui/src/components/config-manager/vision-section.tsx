import { useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSectionShell,
} from "@/components/config-manager/config-section-shell"
import { parseConfigNumberInput } from "@/components/config-manager/numeric-input"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateSettings } from "@/lib/api"

interface VisionSectionProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

export function VisionSection({ config, onConfigChange }: VisionSectionProps) {
  const vision = ((config.services as any)?.vision ?? {}) as {
    screenshotSize?: string
    effectiveResolution?: number
  }
  const [screenshotSize, setScreenshotSize] = useState(vision.screenshotSize ?? "")
  const [effectiveResolution, setEffectiveResolution] = useState(
    vision.effectiveResolution != null ? String(vision.effectiveResolution) : "",
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const parsedResolution = parseConfigNumberInput(effectiveResolution, {
      label: "Effective Resolution",
      min: 1,
      integer: true,
      allowEmpty: true,
    })

    if (parsedResolution.error) {
      toast.error(parsedResolution.error)
      return
    }

    setSaving(true)
    try {
      await updateSettings({
        'services.vision': {
          screenshotSize: screenshotSize || undefined,
          effectiveResolution: parsedResolution.value,
        },
      })
      onConfigChange()
      toast.success("Configuration saved")
    } catch {
      toast.error("Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigSectionShell>
      <ConfigSectionHeader>
        <h2 className="text-base font-semibold">Vision</h2>
        <p className="text-sm text-muted-foreground">Shared screenshot sizing applied to every vision-capable model.</p>
      </ConfigSectionHeader>
      <ConfigSectionBody>
        <div className="space-y-2">
          <Label htmlFor="vision-screenshot-size">
            Screenshot Size
            <span className="text-muted-foreground font-normal"> (optional)</span>
          </Label>
          <Input
            id="vision-screenshot-size"
            type="text"
            placeholder='e.g., "256k" (empty = no compression)'
            value={screenshotSize}
            onChange={(e) => setScreenshotSize(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shared max screenshot size sent to every vision model (e.g. "256k"). Empty = no compression.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="vision-effective-resolution">
            Effective Resolution
            <span className="text-muted-foreground font-normal"> (optional)</span>
          </Label>
          <Input
            id="vision-effective-resolution"
            type="number"
            min={1}
            placeholder="e.g., 768"
            value={effectiveResolution}
            onChange={(e) => setEffectiveResolution(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shared max screenshot edge in px sent to vision models. Default 768.
          </p>
        </div>

        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save Changes"}
        </Button>
      </ConfigSectionBody>
    </ConfigSectionShell>
  )
}
