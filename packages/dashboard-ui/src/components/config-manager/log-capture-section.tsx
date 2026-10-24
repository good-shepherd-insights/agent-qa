import { ConfigField } from "@/components/config-manager/config-field"
import { LOG_CAPTURE_FIELD_LABELS } from "@/lib/config-copy"
import { REQUIRED_SIBLING_BLOCKS } from "@/lib/config-fields"

const LOG_CAPTURE_LEAVES = ["console", "network"] as const
const LOG_CAPTURE_DEFAULTS = REQUIRED_SIBLING_BLOCKS["use.logCapture"]

export function LogCaptureSection() {
  return (
    <>
      {LOG_CAPTURE_LEAVES.map((leaf) => (
        <ConfigField
          key={leaf}
          field={{ segments: ["use", "logCapture", leaf], tab: "execution", pattern: `use.logCapture.${leaf}` }}
          label={LOG_CAPTURE_FIELD_LABELS[leaf]}
          kind="switch"
          defaultChecked={LOG_CAPTURE_DEFAULTS[leaf]}
        />
      ))}
    </>
  )
}
