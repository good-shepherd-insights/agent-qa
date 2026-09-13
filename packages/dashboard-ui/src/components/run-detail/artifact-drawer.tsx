import { useState } from "react"
import { AlertCircle, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScreenshotViewer } from "@/components/screenshot-viewer"
import type { RunArtifactResponse, RunRow } from "@/lib/api"
import { copyTextOf } from "@/lib/display-text"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { ArtifactConfigTab } from "./artifact-config-tab"
import { EvidenceIncomplete } from "./evidence-incomplete"
import { MaskedText } from "./masked-text"

// THE FOURTH TAB IS THE FAILURE VIEW'S OPEN TARGET (406-08 · D-02, second half).
//
// A screenshot the verdict cites is one click from the sentence, and it lands HERE — in the drawer
// a reader already reaches with `i` / `c` — rather than in an inline pane under the sentence
// (rejected: it duplicates the overview's rendering and grows the page once per red member) or in a
// window of its own. The record-fed tabs, their shortcuts and their cells are untouched; the
// screenshot tab has no shortcut and is only reachable from a cited link, which is why its trigger
// is not offered at all when no sha was clicked.
//
// The v1 `memory` tab that once sat beside them is deleted (407-05 · D-02): it read shapes no
// producer has written since v1, and the run-detail Knowledge tab is the live surface for what a
// run was served. `m` opens THAT, and the drawer no longer offers a second answer.
export type ArtifactDrawerTab = "attributes" | "config" | "screenshot"

/** The two tabs the artifact RECORD feeds. The screenshot tab reads blob bytes, not the record. */
type ArtifactShellTab = Exclude<ArtifactDrawerTab, "screenshot">

interface ArtifactDrawerProps {
  run: RunRow
  open: boolean
  tab: ArtifactDrawerTab
  /** The cited artifact's content address, or `null` when the drawer was opened any other way. */
  screenshotSha: string | null
  response: RunArtifactResponse | null
  loading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: ArtifactDrawerTab) => void
  onRetry: () => void
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-label="Loading artifact data">
      <p className="text-sm text-muted-foreground">Loading artifact data...</p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-[2px] border border-border p-4">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-[2px] border border-red-500/20 bg-red-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">Could not load artifact data</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Retry the request. If it continues, verify the dashboard server can read run artifacts.
          </p>
          <p className="mt-2 break-words font-mono text-xs text-red-500"><MaskedText text={error} /></p>
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  )
}

function MissingArtifactState() {
  return (
    <div className="rounded-[2px] border border-border p-4">
      <h3 className="text-sm font-medium text-foreground">
        Artifact data is not available for this run
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This run does not have a persisted artifact record.
      </p>
    </div>
  )
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const next = (value as Record<string, unknown>)[key]
  return next && typeof next === "object" && !Array.isArray(next)
    ? next as Record<string, unknown>
    : null
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
  const metadata = recordAt(payload, "metadata")
  return stringAttributesFrom(recordAt(metadata, "attributes"))
}

function sortedAttributeEntries(attributes: Record<string, string>) {
  return Object.entries(attributes).sort(([left], [right]) => {
    const leftInternal = left.startsWith("agent-qa.")
    const rightInternal = right.startsWith("agent-qa.")
    if (leftInternal !== rightInternal) return leftInternal ? -1 : 1
    return left.localeCompare(right)
  })
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(copyTextOf(value))
}

function AttributesTab({ response }: { response: RunArtifactResponse }) {
  const attributes = getRunAttributes(response)
  const entries = sortedAttributeEntries(attributes)

  if (entries.length === 0) {
    return (
      <div className="rounded-[2px] border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">No run attributes</h3>
        <p className="mt-1 text-sm text-muted-foreground">This run did not record any attributes.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => copyText(JSON.stringify(Object.fromEntries(entries), null, 2))}
        >
          <Copy className="size-4" />
          Copy JSON
        </Button>
      </div>
      <div className="overflow-hidden rounded-[2px] border border-border">
        <table className="w-full table-fixed text-sm">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-b border-border/70 last:border-b-0">
                <th className="w-[240px] align-top px-3 py-2 text-left font-mono text-xs font-medium text-muted-foreground">
                  {copyTextOf(key)}
                </th>
                <td className="align-top px-3 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground"><MaskedText text={value} /></span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Copy ${copyTextOf(key)} value`}
                      title="Copy value"
                      onClick={() => copyText(value)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ShellTabContent({
  tab,
  response,
}: {
  tab: ArtifactShellTab
  response: RunArtifactResponse
}) {
  if (tab === "attributes") {
    return <AttributesTab response={response} />
  }

  return <ArtifactConfigTab response={response} />
}

function DrawerBody({
  tab,
  response,
  loading,
  error,
  onRetry,
}: { tab: ArtifactShellTab } & Pick<ArtifactDrawerProps, "response" | "loading" | "error" | "onRetry">) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!response) return <MissingArtifactState />
  if (tab !== "attributes" && !response.artifact) return <MissingArtifactState />
  return <ShellTabContent tab={tab} response={response} />
}

/**
 * The cited screenshot itself (405 D-12 / D-15).
 *
 * ONE MINTER, NO SECOND SPELLING. `routes.runArtifact` is the only place in this app that writes an
 * artifact URL; this tab resolves the sha it was handed through it and passes the result down. The
 * server's own hex regex is what refuses anything that is not a content address, so a sha that
 * arrived from a producer never becomes a path this file assembled.
 *
 * AND A BLOB THAT VANISHED BETWEEN THE READ AND THE CLICK STILL SAYS SO. The durable read stats the
 * store and the page already paints `evidence-incomplete` for what it found missing — but a blob
 * can go between that read and this request, and `runs.artifact` answers its `blob_absent` refusal.
 * The viewer reports that through `onUnavailable` and this tab paints the SAME component the
 * read-time absence paints: one state, one vocabulary, two roads to it (D-18).
 */
function ScreenshotTab({ runId, sha }: { runId: string; sha: string | null }) {
  const [unavailableSha, setUnavailableSha] = useState<string | null>(null)

  if (sha === null || unavailableSha === sha) {
    return (
      <div data-artifact-state="unavailable" className="h-full w-full">
        <EvidenceIncomplete variant="pane" />
      </div>
    )
  }

  return (
    <div data-artifact-state="available" className="min-w-0">
      <ScreenshotViewer
        src={routes.runArtifact(runId, sha)}
        className="w-full overflow-hidden rounded-sm"
        onUnavailable={() => { setUnavailableSha(sha) }}
      />
    </div>
  )
}

export function ArtifactDrawer({
  run,
  open,
  tab,
  screenshotSha,
  response,
  loading,
  error,
  onOpenChange,
  onTabChange,
  onRetry,
}: ArtifactDrawerProps) {
  const artifact = response?.artifact ?? null
  const description = run.name || `Run ${run.id}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(820px,92vw)] sm:max-w-none gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base leading-snug">Run details</SheetTitle>
          <SheetDescription className="truncate text-xs"><MaskedText text={description} /></SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span className="break-all font-mono">{run.id}</span>
            {artifact ? (
              <>
                <Badge variant="outline" className="text-[10px]">
                  {artifact.kind}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  schema {artifact.schemaVersion}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    artifact.finalizedAt
                      ? "border-emerald-500/20 text-emerald-500"
                      : "border-amber-500/25 text-amber-500",
                  )}
                >
                  {artifact.finalizedAt ? "finalized" : "open"}
                </Badge>
              </>
            ) : null}
          </div>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as ArtifactDrawerTab)}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="border-b px-3">
            <TabsList variant="line" className="h-9 w-full justify-start">
              <TabsTrigger value="attributes" className="max-w-32 flex-none">
                Attributes
              </TabsTrigger>
              <TabsTrigger value="config" className="max-w-32 flex-none">
                Config
              </TabsTrigger>
              {screenshotSha === null ? null : (
                <TabsTrigger
                  value="screenshot"
                  data-artifact-drawer-tab="screenshot"
                  className="max-w-32 flex-none"
                >
                  Screenshot
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="attributes" className="m-0 px-4 py-4">
              <DrawerBody
                tab="attributes"
                response={response}
                loading={loading}
                error={error}
                onRetry={onRetry}
              />
            </TabsContent>
            <TabsContent value="config" className="m-0 px-4 py-4">
              <DrawerBody
                tab="config"
                response={response}
                loading={loading}
                error={error}
                onRetry={onRetry}
              />
            </TabsContent>
            <TabsContent value="screenshot" className="m-0 px-4 py-4">
              {/* Deliberately NOT through `DrawerBody`: the artifact record's loading, error and
                  missing-row states describe a different read entirely, and a run with no persisted
                  artifact row can still have the blob this tab was opened to show. */}
              <ScreenshotTab runId={run.id} sha={screenshotSha} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
