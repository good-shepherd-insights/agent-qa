// MCP ACCESS (429-27 · D-05, D-06 · UI-SPEC S7 "MCP access").
//
// Every services.mcp leaf as one ConfigField. The fields edit what the file declares and nothing
// else. 2026-10-01 (432-22, D-12): MCP is tokenless, so the access tokens list and the stdio
// config-write switch are gone with their keys; enablement, transport, host, port and path remain.

import { ConfigField } from "@/components/config-manager/config-field"
import type { ConfigFieldParse } from "@/hooks/use-config-autosave"
import {
  MCP_FIELD_HELP,
  MCP_FIELD_LABELS,
  MCP_HOST_ERROR,
  MCP_PATH_ERROR,
  MCP_TRANSPORT_LABELS,
  MCP_TRANSPORT_PLACEHOLDER,
} from "@/lib/config-copy"

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"]
const UNSET: ConfigFieldParse = { valid: true, unset: true }

const TRANSPORT_OPTIONS = (Object.keys(MCP_TRANSPORT_LABELS) as (keyof typeof MCP_TRANSPORT_LABELS)[]).map((value) => ({
  value,
  label: MCP_TRANSPORT_LABELS[value],
}))

function parseHost(raw: string): ConfigFieldParse {
  const host = raw.trim()
  if (host === "") return UNSET
  return LOOPBACK_HOSTS.includes(host) ? { valid: true, value: host } : { valid: false, error: MCP_HOST_ERROR }
}

function parsePath(raw: string): ConfigFieldParse {
  const path = raw.trim()
  if (path === "") return UNSET
  return path.startsWith("/") ? { valid: true, value: path } : { valid: false, error: MCP_PATH_ERROR }
}

function mcpField(...rest: string[]) {
  return { segments: ["services", "mcp", ...rest], tab: "advanced" as const, pattern: ["services", "mcp", ...rest].join(".") }
}

export function McpSection() {
  return (
    <>
      <ConfigField
        field={mcpField("enabled")}
        label={MCP_FIELD_LABELS.enabled}
        kind="switch"
        help={MCP_FIELD_HELP.enabled}
        defaultChecked
      />
      <ConfigField
        field={mcpField("transport")}
        label={MCP_FIELD_LABELS.transport}
        kind="select"
        placeholder={MCP_TRANSPORT_PLACEHOLDER}
        options={TRANSPORT_OPTIONS}
      />
      <ConfigField
        field={mcpField("host")}
        label={MCP_FIELD_LABELS.host}
        kind="text"
        help={MCP_FIELD_HELP.host}
        placeholder="127.0.0.1"
        parse={parseHost}
      />
      <ConfigField
        field={mcpField("port")}
        label={MCP_FIELD_LABELS.port}
        kind="number"
        placeholder="3471"
        number={{ min: 1, max: 65535, integer: true }}
      />
      <ConfigField field={mcpField("path")} label={MCP_FIELD_LABELS.path} kind="text" parse={parsePath} />
    </>
  )
}
