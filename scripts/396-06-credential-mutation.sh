#!/usr/bin/env bash
#
# 396-06-credential-mutation.sh — the acceptance bar for the credential surface (396-06, Pitfall 9;
# re-spelled 2026-10-02 by 432-44 for D-05 and D-12).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Every claim in
# `mcp-credential-surface.test.ts` is an ABSENCE, and an absence is the easiest kind of claim to
# fake: it passes over a channel that returns nothing, over a fixture that lost its plant, and over
# a value the pipeline never saw. The suite carries its own controls for the first two (an integrity
# half on every cell, a hostile control that requires a value to be FOUND). This script carries the
# third: each masking leg removes one masking mechanism and requires the cells aimed at it to go red.
#
# THE LEGS
#
#   C1  the SUCCESS path stops masking at all (`masked-result.ts`). Every tool's serialized output
#       is then raw on both channels — the ordinary path a model reads.
#   C2  THE SHIPPED DEFECT, restored: `structuredContent` is answered from the UNMASKED op output
#       while `content` stays masked. The only leg that tells a corpus reading `structuredContent`
#       from one reading `content` alone.
#   C3  the ERROR path stops masking. T-395-R5-10's own channel: the 395 defect travelled out
#       through an error serialization, not through a success payload, and the two are separate
#       call sites — so they get separate legs. (Re-anchored 2026-10-02: the message is now bound to
#       a local before it is masked.)
#   C4  CARRIED (432-44). This leg unmasked the apply refusal's teach (`apply-refusal.ts`), the one
#       handler registered beside the generic one. D-05 deleted the apply confirmation round with the
#       apply tools, so every tool now answers through the generic handler C1-C3 sever. The claim it
#       guarded — no second, directly registered result site — is now the apply tool's absence: C4
#       projects `agent_qa_apply_proposal` again and must red C432-RETURN-A36.
#   C5  RE-SPELLED (432-44). This leg cut the DECLARED credentials (`services.mcp.tokens`) off the
#       masker while the environment arm kept seeding it. D-12 deleted the declared tokens, so the
#       environment is the one seed left (A2 now reads both plants off it); C5 cuts THAT arm and the
#       pattern arm of the config-write channel (E1), a different mechanism, must stay green.
#   C6  CARRIED (432-44): the declared tokens return — `services.mcp.tokens` on the public config
#       parser, its entry DTO, barrels and core's import (C432-RETURN-A59; schema then core rebuilt).
#   C7  CARRIED (432-44): a request bearer-denial branch returns on the MCP listener (C432-RETURN-A60).
#   C8  CARRIED (432-44): the credential caller key returns on FunctionCaller (C432-RETURN-A56).
#
# C6-C8 are the "credential-required calls" claim owners in 432-MUTATION-MAP.md (caller, key and check
# absence rows); tokenless discovery itself is pinned by 432-21's cells.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named cell.
#
# DIST REBUILDS: `packages/cli`'s vitest config declares no aliases, so its import of
# `@vostride/agent-qa-mcp` resolves through that package's BUILT `dist`. C1-C3 rebuild the mcp package
# and find their own marker in it (the marker is a code identifier the bundler keeps, never a comment).
# C5 and C7 mutate `packages/cli`, which vitest resolves from source.
#
# THE WIRING GREPS of the old script (one maskedToolResult site, one maskJsonDocument call, both
# channels from one masked value, no masker handed a serialization) are measured by C1 and C2 as
# behaviour and by `masked-serialization.test.ts`; the apply handler's site counts left with it.
#
# Engine, arrival proof, counted selection, byte-exact restoration, rebuilds and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-06-credential-mutation.sh
#
# KNOBS — CREDENTIAL_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# CREDENTIAL_MUTATION_LEG=C1..C8 runs one leg; CREDENTIAL_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const SURFACE_T = 'src/__tests__/mcp-credential-surface.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const MASKED_SRC = 'packages/mcp/src/masked-result.ts'
const MCP_CMD_SRC = 'packages/cli/src/commands/mcp.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  surface: { pkg: 'packages/cli', files: [SURFACE_T], typecheck: false, count: 15, env: { VITEST_MAX_WORKERS: '1' } },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
}

const edit = (from, to) => ({ from, to })
const surface = name => cell('surface', SURFACE_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const DELETED_FILES = census('C432-DELETED-SYMBOLS: every deleted module file is absent')
const DELETED_BARREL = census('C432-DELETED-SYMBOLS: no package barrel names a deleted export in code')
const DELETED_DECLARED = census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]
const mcpCrossing = marker => ({ pkg: '@vostride/agent-qa-mcp', dir: 'packages/mcp', marker })

const A1 = surface('(A1) every plant is really where the fixture put it, and the bytes are the pinned bytes')
const A2 = surface('(A2) the masker recognises exactly the two SEEDED plants, and nothing else')
const B1 = surface('(B1) the echoing read path masks both seeded plants, in the result AND in the frames')
const B1B = surface("(B1b) the SUCCESS payload of a read tool that echoes the caller's own string is masked on BOTH channels — text and structuredContent")
const B2 = surface('(B2) the other read doors carry no window of either seeded plant either')
const C1_CELL = surface("(C1) an op-side refusal composed from the caller's own string is masked")
const D1 = surface('(D1) neither the prose nor the structured answer carries a window of a seeded plant')
const E1 = surface('(E1) a credential-SHAPED value is blocked by the pattern arm, and the wire carries a fingerprint instead of the value')
const E2 = surface('(E2) a value the environment SEEDED is blocked by the seed arm — a different mechanism')
const F1 = surface('(F1) HOSTILE CONTROL: an UNSEEDED value travels the same channel verbatim, and the helper finds it')

// The A59 return, spelled as 432-43 restores it: the key on core's McpConfigSchema with its import,
// the entry DTO created at its old path, and the config and root barrel exports.
const SERVICES_SRC = 'packages/core/src/schema/services-schema.ts'
const SERVICES_IMPORT = "import { DurationString, SizeString } from './primitives.js'"
const MCP_LAST_KEY = "  path: z.string().trim().min(1).regex(/^\\//, 'MCP path must start with /').optional(),\n}).strict()"
const CONFIG_BARREL_ANCHOR = "export { deviceConfigSchema } from './device'\n"
const MCP_TOKEN_DTO = `import { z } from 'zod'

// 432-44 C6: the retired MCP token entry, its scope enum spelled here (no deleted FunctionScope).
export const McpTokenEntrySchema = z.object({
  name: z.string().trim().min(1),
  tokenEnvVar: z.string().trim().min(1),
  scopes: z.array(z.enum(['read', 'run', 'config-write', 'knowledge-write', 'approval-write', 'test-write'])).min(1),
}).strict()

export type McpTokenEntry = z.infer<typeof McpTokenEntrySchema>
`

const legs = [
  {
    id: 'C1', claim: 'SUCCESS-PATH-MASKED', instrument: 'surface', subject: MASKED_SRC,
    operation: 'the success path stops masking: the masker becomes a pass-through',
    edits: [edit('  const masked = maskJsonDocument(output, maskText)\n',
      '  const unmaskedLeg396C1 = (text: string): string => text\n  const masked = maskJsonDocument(output, unmaskedLeg396C1)\n')],
    crossing: mcpCrossing('unmaskedLeg396C1'),
    reds: [B1B],
    allowed: [D1],
    greens: [A2, C1_CELL, E1, F1],
  },
  {
    id: 'C2', claim: 'STRUCTURED-CHANNEL-MASKED', instrument: 'surface', subject: MASKED_SRC,
    operation: 'the shipped defect: structuredContent answered from the unmasked op output',
    edits: [edit("  return {\n    content: [{ type: 'text' as const, text: masked.text }],\n    structuredContent: masked.value as CallToolResult['structuredContent'],\n  }\n",
      "  const rawChannelLeg396C2 = output\n  return {\n    content: [{ type: 'text' as const, text: masked.text }],\n    structuredContent: rawChannelLeg396C2 as CallToolResult['structuredContent'],\n  }\n")],
    crossing: mcpCrossing('rawChannelLeg396C2'),
    reds: [B1B],
    allowed: [D1],
    greens: [A2, B1, C1_CELL, E1, F1],
  },
  {
    id: 'C3', claim: 'ERROR-PATH-MASKED', instrument: 'surface', subject: MASKED_SRC,
    operation: 'the error path stops masking: the refusal message is answered raw',
    edits: [edit('        text: maskText(message),\n', '        text: unmaskedLeg396C3(message),\n'),
      edit('  const message = err instanceof Error ? err.message : String(err)\n',
        '  const message = err instanceof Error ? err.message : String(err)\n  const unmaskedLeg396C3 = (text: string): string => maskText === undefined ? text : text\n')],
    crossing: mcpCrossing('unmaskedLeg396C3'),
    reds: [C1_CELL],
    allowed: [B1],
    greens: [A2, B1B, D1, E1, F1],
  },
  {
    id: 'C4', claim: 'C432-RETURN-A36', instrument: 'census', subject: 'packages/mcp/src/mapping.ts',
    operation: 'the directly registered apply site: project agent_qa_apply_proposal again over knowledge.accept',
    edits: [edit('export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([\n',
      "export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([\n  Object.freeze({\n    name: 'agent_qa_apply_proposal',\n    ops: Object.freeze(['knowledge.accept']),\n    kind: 'workflow',\n  }),\n")],
    reds: [census('C432-RETURN-A36', 'A36: the apply-proposal tool returned (agent_qa_apply_proposal)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A38')],
  },
  {
    id: 'C5', claim: 'ENVIRONMENT-SEED-REACHES-MASKER', instrument: 'surface', subject: MCP_CMD_SRC,
    operation: 'the environment stops seeding the masker (the one seed arm left)',
    edits: [edit('  return buildRunMaskingContext({ env: input.env })\n',
      '  return buildRunMaskingContext({ env: {} })\n')],
    reds: [A2],
    // Every cell that needs a seeded plant masked on the wire sees it raw (measured).
    allowed: [B1, B1B, C1_CELL, D1],
    // The pattern arm refuses a credential-shaped value by its shape, not by the seed; E2's seed-arm
    // refusal and B2's read doors stay green (measured 2026-10-02).
    greens: [A1, B2, E1, E2, F1],
  },
  {
    id: 'C6', claim: 'C432-RETURN-A59', instrument: 'census', subject: SERVICES_SRC,
    operation: 'the declared tokens return: services.mcp.tokens, its entry DTO, the barrels and core’s import',
    edits: [edit(SERVICES_IMPORT, `import { McpTokenEntrySchema } from '@vostride/agent-qa-schema'\n${SERVICES_IMPORT}`),
      edit(MCP_LAST_KEY, MCP_LAST_KEY.replace('\n}).strict()', '\n  tokens: z.array(McpTokenEntrySchema).default([]),\n}).strict()'))],
    also: [
      { subject: 'packages/schema/src/config/mcp.ts', create: MCP_TOKEN_DTO },
      { subject: 'packages/schema/src/config/index.ts', edits: [edit(CONFIG_BARREL_ANCHOR,
        `${CONFIG_BARREL_ANCHOR}export type { McpTokenEntry } from './mcp'\nexport { McpTokenEntrySchema } from './mcp'\n`)] },
      { subject: 'packages/schema/src/index.ts', edits: [edit('  MaskingClass,\n', '  MaskingClass,\n  McpTokenEntry,\n'),
        edit('  MASKING_CLASSES,\n', '  MASKING_CLASSES,\n  McpTokenEntrySchema,\n')] },
    ],
    crossing: { pkg: '@vostride/agent-qa-core', dir: 'packages/core', marker: 'McpTokenEntrySchema',
      reference: "'core/dist/index.js'", byPath: true, before: [{ pkg: '@vostride/agent-qa-schema', dir: 'packages/schema' }] },
    reds: [census('C432-RETURN-A59', 'the public parser accepts the removed member (services.mcp.tokens)')],
    allowed: [DELETED_FILES, DELETED_BARREL, DELETED_DECLARED],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A60')],
  },
  {
    id: 'C7', claim: 'C432-RETURN-A60', instrument: 'census', subject: MCP_CMD_SRC,
    operation: 'a request bearer-denial branch returns on the MCP listener',
    edits: [edit("      return refuse(res, 403, 'forbidden_origin')\n    }\n",
      "      return refuse(res, 403, 'forbidden_origin')\n    }\n"
      + '    const bearer = (input as { readonly bearerToken?: string }).bearerToken\n'
      + '    if (bearer !== undefined && req.headers.authorization !== `Bearer ${bearer}`) {\n'
      + "      res.setHeader('WWW-Authenticate', 'Bearer')\n"
      + "      return refuse(res, 401, 'unauthorized')\n"
      + '    }\n')],
    reds: [census('C432-RETURN-A60', 'A60: the MCP bearer check returned (Bearer)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A59'), census('C432-RETURN-A56')],
  },
  {
    id: 'C8', claim: 'C432-RETURN-A56', instrument: 'census', subject: 'packages/schema/src/functions/function-caller.ts',
    operation: 'the credential caller key returns on FunctionCaller',
    edits: [edit('  origin: FunctionCallerOrigin\n}', '  origin: FunctionCallerOrigin\n  credential?: string\n}')],
    reds: [census('C432-RETURN-A56', 'A56: the credential caller key returned (credential)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A60')],
  },
]

runGate({
  slug: '396-06-credential-mutation', envPrefix: 'CREDENTIAL_MUTATION',
  instruments, legs, expectedLegs: 8, explicitIds: true, parseCheck: true, banner: 'CREDENTIAL_SURFACE_MUTATION_OK',
})
NODE
