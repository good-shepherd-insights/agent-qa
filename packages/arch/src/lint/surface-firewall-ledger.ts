/**
 * FUNC-02 surface firewall ledger (D-01 / D-03, minted 2026-07-28, Phase 384).
 *
 * The transitional-core precedent applied to surfaces, at ONE granularity finer: an
 * entry waives an exact (file, specifier) PAIR, never a file and never a directory.
 * A ledgered file that acquires a second forbidden import still fails the build.
 *
 * Rules of this ledger:
 *   - It only ever SHRINKS. New surface code can never join it; a leak in a file
 *     written after 2026-07-28 is fixed, not waived.
 *   - Every entry names the phase that deletes it (`clearedBy`) and why it exists.
 *   - An entry whose leak has been cleared FAILS the build as stale, so the phase
 *     that clears a file is forced to delete its entries in the same commit.
 */
export interface SurfaceLedgerEntry {
  /** Repo-relative path, forward slashes, exact — no directory prefixes. */
  file: string
  /** The exact import specifier as written, including any subpath. */
  specifier: string
  /** The phase or milestone whose completion deletes this entry. */
  clearedBy: string
  /** Why the pair exists today and what supersedes it. */
  reason: string
}

export function surfaceLedgerKey(entry: Pick<SurfaceLedgerEntry, 'file' | 'specifier'>): string {
  return `${entry.file.replaceAll('\\', '/')} :: ${entry.specifier}`
}

export const SURFACE_FIREWALL_LEDGER: readonly SurfaceLedgerEntry[] = [
  {
    file: 'packages/cli/src/commands/auth-state.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'auth-state inspection reads resolved config directly; moves behind the typed config action class',
  },
  {
    file: 'packages/cli/src/commands/auth.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'auth command mutates provider credentials in place; superseded by the config/environment mutation class',
  },
  {
    file: 'packages/cli/src/commands/auth.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '395',
    reason: 'auth command mutates provider credentials in place; superseded by the config/environment mutation class',
  },
  {
    file: 'packages/cli/src/commands/baseline-probe.ts',
    specifier: '@vostride/agent-qa-runner',
    clearedBy: '386',
    reason: 'probe builds a run session in-process; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/cache.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'model/response cache administration over host paths; joins the config and environment action class',
  },
  {
    file: 'packages/cli/src/commands/create-suite.ts',
    specifier: '@vostride/agent-qa-ids',
    clearedBy: '394',
    reason: 'suite scaffolding mints ids locally; moves behind the write_test authoring loop',
  },
  {
    file: 'packages/cli/src/commands/create-test.ts',
    specifier: '@vostride/agent-qa-ids',
    clearedBy: '394',
    reason: 'test scaffolding mints ids locally; moves behind the write_test authoring loop',
  },
  {
    file: 'packages/cli/src/commands/dashboard.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: 'M5',
    reason: 'dashboard spawn and asset resolution; rewired when the dashboards themselves enter the firewall in M5',
  },
  {
    file: 'packages/cli/src/commands/dashboard.ts',
    specifier: '@vostride/agent-qa-dashboard',
    clearedBy: 'M5',
    reason: 'dashboard spawn and asset resolution; rewired when the dashboards themselves enter the firewall in M5',
  },
  {
    file: 'packages/cli/src/commands/dashboard.ts',
    specifier: '@vostride/agent-qa-dashboard-ui/package.json',
    clearedBy: 'M5',
    reason: 'dashboard spawn and asset resolution; rewired when the dashboards themselves enter the firewall in M5',
  },
  {
    file: 'packages/cli/src/commands/dashboard.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: 'M5',
    reason: 'dashboard spawn and asset resolution; rewired when the dashboards themselves enter the firewall in M5',
  },
  {
    file: 'packages/cli/src/commands/direct-run-members.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '386',
    reason: 'direct run member assembly; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/direct-run-members.ts',
    specifier: '@vostride/agent-qa-runner',
    clearedBy: '386',
    reason: 'direct run member assembly; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/doctor.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'environment diagnosis probes hosts and model config directly; joins the environment action class',
  },
  {
    file: 'packages/cli/src/commands/doctor.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '395',
    reason: 'environment diagnosis probes hosts and model config directly; joins the environment action class',
  },
  {
    file: 'packages/cli/src/commands/doctor.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '395',
    reason: 'environment diagnosis probes hosts and model config directly; joins the environment action class',
  },
  {
    file: 'packages/cli/src/commands/ids.ts',
    specifier: '@vostride/agent-qa-ids',
    clearedBy: '387',
    reason: 'id minting exposed as a debug verb; superseded by entity addressing and the short-ID resolver',
  },
  {
    file: 'packages/cli/src/commands/init.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'project scaffolding writes config and model defaults; joins the config mutation class',
  },
  {
    file: 'packages/cli/src/commands/init.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '395',
    reason: 'project scaffolding writes config and model defaults; joins the config mutation class',
  },
  {
    file: 'packages/cli/src/commands/install-browsers.ts',
    specifier: '@vostride/agent-qa-web',
    clearedBy: '395',
    reason: 'browser driver installation is host mutation; joins the environment action class',
  },
  {
    file: 'packages/cli/src/commands/install-mobile-drivers.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'mobile driver installation is host mutation; joins the environment action class',
  },
  {
    file: 'packages/cli/src/commands/knowledge-maintain.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '387',
    reason: 'record-level knowledge maintenance; migrates into the layer with the knowledge review verb family',
  },
  {
    file: 'packages/cli/src/commands/knowledge-maintain.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '387',
    reason: 'record-level knowledge maintenance; migrates into the layer with the knowledge review verb family',
  },
  {
    file: 'packages/cli/src/commands/knowledge-maintain.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '387',
    reason: 'record-level knowledge maintenance; migrates into the layer with the knowledge review verb family',
  },
  {
    file: 'packages/cli/src/commands/knowledge-maintain.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '387',
    reason: 'record-level knowledge maintenance; migrates into the layer with the knowledge review verb family',
  },
  {
    file: 'packages/cli/src/commands/knowledge-read.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '387',
    reason: 'the legacy inspect/diff verbs beside the 384 bundles thin client; the review verb family owns their rewire (D-07 dated reconciliation)',
  },
  {
    file: 'packages/cli/src/commands/knowledge-read.ts',
    specifier: '@vostride/agent-qa-knowledge-local/reader',
    clearedBy: '387',
    reason: 'the legacy inspect/diff verbs beside the 384 bundles thin client; the review verb family owns their rewire (D-07 dated reconciliation)',
  },
  {
    file: 'packages/cli/src/commands/knowledge-read.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '387',
    reason: 'the legacy inspect/diff verbs beside the 384 bundles thin client; the review verb family owns their rewire (D-07 dated reconciliation)',
  },
  {
    file: 'packages/cli/src/commands/mcp.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '396',
    reason: 'spawns the v1 MCP server; rewritten with the SDK re-derivation',
  },
  {
    file: 'packages/cli/src/commands/mcp.ts',
    specifier: '@vostride/agent-qa-mcp',
    clearedBy: '396',
    reason: 'spawns the v1 MCP server; rewritten with the SDK re-derivation',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-android',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-dashboard',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-ios',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-runner',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-safety-local',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/run.ts',
    specifier: '@vostride/agent-qa-web',
    clearedBy: '386',
    reason: 'the run command wires runner, safety, and every platform driver by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/commands/validate.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'config and suite validation reads resolved config directly; joins the config action class',
  },
  {
    // 2026-07-29 (Phase 385 plan 09, D-15): four of this file's five entries are GONE, not moved.
    // The reader, runner, runner-local and safety-local leaks left with the registry assembly that
    // caused them, which now lives in composeLocalAgent(). What survives is config resolution — a
    // different debt from the one 386 clears, so the clearing phase is restated as the typed config
    // action class rather than left pointing at a phase that no longer touches this line.
    file: 'packages/cli/src/composition/local-agent-host.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'the CLI half of the local host resolves and masks configuration directly; joins the typed config action class',
  },
  {
    file: 'packages/cli/src/config.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'CLI config resolution helper; joins the typed config action class',
  },
  {
    file: 'packages/cli/src/curation/authoring-test-discovery.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '388',
    reason: 'authoring-side test discovery in the curation pipeline; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/authoring-test-discovery.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '388',
    reason: 'authoring-side test discovery in the curation pipeline; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-runner',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curation-tail.ts',
    specifier: '@vostride/agent-qa-safety-local',
    clearedBy: '388',
    reason: 'the post-run curation tail runs in-process today; moves behind the analyze-run job chain',
  },
  {
    file: 'packages/cli/src/curation/curator-author.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '388',
    reason: 'curator authoring pass over the knowledge store; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/curation/curator-author.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '388',
    reason: 'curator authoring pass over the knowledge store; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/curation/emit-canary-outcomes.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '388',
    reason: 'canary outcome emission writes knowledge directly; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/curation/emit-candidates.ts',
    specifier: '@vostride/agent-qa-knowledge-local',
    clearedBy: '388',
    reason: 'candidate emission writes knowledge directly; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/curation/emit-candidates.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '388',
    reason: 'candidate emission writes knowledge directly; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/curation/emit-candidates.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '388',
    reason: 'candidate emission writes knowledge directly; moves behind the curate-memory job',
  },
  {
    file: 'packages/cli/src/devices.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'device/target resolution over host config; joins the environment action class',
  },
  {
    file: 'packages/cli/src/eval-report-render.ts',
    specifier: '@vostride/agent-qa-eval',
    clearedBy: '386',
    reason: 'eval report rendering types against the eval package; relocates with the eval session composition',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-eval',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-eval-local',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-runner',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-runner-local',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/eval-session-composition.ts',
    specifier: '@vostride/agent-qa-safety-local',
    clearedBy: '386',
    reason: 'the eval session composition root; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/index.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '386',
    reason: 'the CLI entry still resolves host paths itself; relocates with the composition root',
  },
  {
    file: 'packages/cli/src/llm-utils.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'model client construction over resolved config; joins the config action class',
  },
  {
    file: 'packages/cli/src/llm-utils.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '395',
    reason: 'model client construction over resolved config; joins the config action class',
  },
  {
    file: 'packages/cli/src/provider-plugins.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'provider plugin loading over resolved config; joins the config action class',
  },
  {
    file: 'packages/cli/src/provider-plugins.ts',
    specifier: '@vostride/agent-qa-model',
    clearedBy: '395',
    reason: 'provider plugin loading over resolved config; joins the config action class',
  },
  {
    file: 'packages/cli/src/reporters/console-reporter.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '386',
    reason: 'the run reporter crosses the display boundary directly; relocates with the run-session composition root',
  },
  {
    file: 'packages/cli/src/run-session-composition.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '386',
    reason: 'the 1035-line in-CLI run session composition; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/run-session-composition.ts',
    specifier: '@vostride/agent-qa-safety-local',
    clearedBy: '386',
    reason: 'the 1035-line in-CLI run session composition; superseded by composeLocalAgent()',
  },
  {
    file: 'packages/cli/src/targets.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '395',
    reason: 'target resolution over host config; joins the environment action class',
  },
  {
    file: 'packages/cli/src/version-notice.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '386',
    reason: 'version notice reads host state directly; relocates with the composition root',
  },
  {
    file: 'packages/cli/src/wm-flush.ts',
    specifier: '@vostride/agent-qa-safety',
    clearedBy: '386',
    reason: 'working-memory flush wires safety ports by hand; relocates with the run-session composition root',
  },
  {
    file: 'packages/mcp/src/agent-qa-server.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '396',
    reason: 'the v1 37-tool MCP server, scheduled for deletion in the SDK re-derivation - ledgered, never fixed',
  },
  {
    file: 'packages/mcp/src/agent-qa-server.ts',
    specifier: '@vostride/agent-qa-ids',
    clearedBy: '396',
    reason: 'the v1 37-tool MCP server, scheduled for deletion in the SDK re-derivation - ledgered, never fixed',
  },
  {
    file: 'packages/mcp/src/schema-reference.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '396',
    reason: 'v1 MCP schema reference tooling, deleted with the v1 server',
  },
  {
    file: 'packages/mcp/src/schema-reference.ts',
    specifier: '@vostride/agent-qa-ids',
    clearedBy: '396',
    reason: 'v1 MCP schema reference tooling, deleted with the v1 server',
  },
  {
    file: 'packages/mcp/src/server.ts',
    specifier: '@vostride/agent-qa-core',
    clearedBy: '396',
    reason: 'v1 MCP server entry, deleted with the v1 server',
  },
]
