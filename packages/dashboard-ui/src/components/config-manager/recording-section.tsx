import { ConfigField, type ConfigFieldTarget } from "@/components/config-manager/config-field"
import { RECORDING_FIELD_HELP, RECORDING_FIELD_LABELS } from "@/lib/config-copy"

function recordingField(leaf: "enabled" | "keepFailuresOnly"): ConfigFieldTarget {
  return {
    segments: ["services", "recording", leaf],
    tab: "execution",
    pattern: `services.recording.${leaf}`,
  }
}

export function RecordingSection() {
  return (
    <>
      <ConfigField
        field={recordingField("enabled")}
        label={RECORDING_FIELD_LABELS.enabled}
        kind="switch"
        help={RECORDING_FIELD_HELP.enabled}
        defaultChecked
      />
      <ConfigField
        field={recordingField("keepFailuresOnly")}
        label={RECORDING_FIELD_LABELS.keepFailuresOnly}
        kind="switch"
        help={RECORDING_FIELD_HELP.keepFailuresOnly}
        defaultChecked={false}
      />
    </>
  )
}
