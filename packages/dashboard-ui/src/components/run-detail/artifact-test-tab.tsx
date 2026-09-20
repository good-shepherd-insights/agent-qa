import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { RunArtifactResponse } from "@/lib/api"
import { DRAWER_COPY } from "@/lib/drawer-view"
import { routes } from "@/lib/routes"
import { ArtifactAttributeRows } from "./artifact-attribute-rows"
import { formatArtifactValue, InspectorSection, isArtifactArray, isArtifactRecord, KeyValueRows, KeyValueTree, RawBlock } from "./artifact-renderers"

function valueAt(record: Record<string, unknown> | null, key: string): unknown {
  return record ? record[key] : undefined
}

function textAt(record: Record<string, unknown> | null, key: string): string | null {
  const value = valueAt(record, key)
  return typeof value === "string" && value.length > 0 ? value : null
}

function recordAt(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = valueAt(record, key)
  return isArtifactRecord(value) ? value : null
}

function arrayAt(record: Record<string, unknown> | null, key: string): unknown[] {
  const value = valueAt(record, key)
  return isArtifactArray(value) ? value : []
}

function terminalErrorMessage(error: unknown): string | null {
  if (!isArtifactRecord(error)) return null
  const code = textAt(error, "code")
  const phase = textAt(error, "phase")
  const message = textAt(error, "message")
  return [code, phase, message].filter(Boolean).join(" - ") || null
}

function stringAttributesFrom(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return Object.fromEntries(entries)
}

function getRunAttributes(response: RunArtifactResponse): Record<string, string> {
  const direct = stringAttributesFrom(response.run.attributes)
  if (Object.keys(direct).length > 0) return direct

  const payload = response.artifact?.payload
  const metadata = recordAt(isArtifactRecord(payload) ? payload : null, "metadata")
  return stringAttributesFrom(recordAt(metadata, "attributes"))
}

function SuiteMembers({
  source,
}: {
  source: Record<string, unknown>
}) {
  const members = arrayAt(source, "members")
    .filter(isArtifactRecord)
    .sort((a, b) => {
      const aIndex = typeof a.index === "number" ? a.index : 0
      const bIndex = typeof b.index === "number" ? b.index : 0
      return aIndex - bIndex
    })

  return (
    <InspectorSection title={DRAWER_COPY.suiteMembers} data-drawer-section="suite-members">
      <div className="space-y-3">
        {members.length === 0 ? DRAWER_COPY.notCaptured : null}
        {members.map((member) => {
          const ref = recordAt(member, "ref")
          const index = typeof member.index === "number" ? member.index : 0
          const childRunId = textAt(member, "childRunId")
          const error = terminalErrorMessage(valueAt(member, "error"))

          return (
            <div
              key={`${index}-${textAt(member, "testId") ?? textAt(ref, "test") ?? "member"}`}
              data-suite-member-index={index}
              className="rounded-[2px] border border-border p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">#{index + 1}</Badge>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">
                  {textAt(member, "name") ?? textAt(ref, "test") ?? "Unnamed member"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {formatArtifactValue(textAt(member, "loadStatus"))}
                </Badge>
              </div>
              <KeyValueRows
                rows={[
                  { label: "Test ID", value: formatArtifactValue(textAt(member, "testId")), mono: true },
                  { label: "Ref", value: formatArtifactValue(textAt(ref, "test")), mono: true },
                  { label: "Ref ID", value: formatArtifactValue(textAt(ref, "id")), mono: true },
                  { label: "Path", value: formatArtifactValue(textAt(member, "filePath")), mono: true },
                  { label: "Target", value: formatArtifactValue(textAt(member, "target")) },
                  {
                    label: "Child run",
                    value: childRunId ? (
                      <a className="break-all text-primary hover:underline" href={routes.runDetail(childRunId)}>
                        {childRunId}
                      </a>
                    ) : "Not captured",
                    mono: Boolean(childRunId),
                  },
                  { label: "Error", value: error ?? "None" },
                ]}
              />
              <Collapsible>
                <CollapsibleTrigger className="group mt-2 flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                  Member snapshots
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  <RawBlock label="Raw member YAML" content={textAt(member, "rawYaml")} />
                  {valueAt(member, "resolvedDefinition") !== undefined ? (
                    <KeyValueTree label="resolvedDefinition" value={valueAt(member, "resolvedDefinition")} />
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )
        })}
      </div>
    </InspectorSection>
  )
}

export function ArtifactTestTab({ response }: { response: RunArtifactResponse }) {
  const payload = response.artifact?.payload
  const source = recordAt(isArtifactRecord(payload) ? payload : null, "source")
  const capturedSource = response.missingSections.includes("source") ? null : source
  const kind = textAt(source, "kind")
  const rawYaml = textAt(capturedSource, "rawYaml")
  const definition = valueAt(capturedSource, "resolvedDefinition")
  const attributes = getRunAttributes(response)

  return (
    <div className="space-y-4">
      <InspectorSection title={DRAWER_COPY.testAsWritten} data-drawer-section="test-as-written">
        {rawYaml ? <RawBlock label={kind === "suite" ? "Raw suite YAML" : "Raw test YAML"} content={rawYaml} /> : DRAWER_COPY.notCaptured}
      </InspectorSection>
      <InspectorSection title={DRAWER_COPY.resolvedDefinition} data-drawer-section="resolved-definition">
        {definition == null ? DRAWER_COPY.notCaptured : <KeyValueTree label="resolvedDefinition" value={definition} />}
      </InspectorSection>
      {kind === "suite" ? <SuiteMembers source={capturedSource ?? {}} /> : null}
      {Object.keys(attributes).length > 0 ? (
        <InspectorSection title={DRAWER_COPY.runAttributes} data-drawer-section="run-attributes">
          <ArtifactAttributeRows attributes={attributes} />
        </InspectorSection>
      ) : null}
    </div>
  )
}
