import { z } from 'zod'
import {
  McpStdioGrantSchema,
  McpTokenEntrySchema,
  RunServiceTokenEntrySchema,
} from '@vostride/agent-qa-schema'
import { DurationString, SizeString } from './primitives.js'

/**
 * Whether a configured value is an ABSOLUTE `http:`/`https:` URL (408 D-08, WR-04 — T-408-16).
 *
 * FILE-LOCAL, DELIBERATELY, unlike `isLoopbackHost` below. That predicate is exported because TWO
 * mechanisms decide loopback membership and must not be two spellings; this one has exactly one
 * decision site — the parse boundary, immediately below. Exporting it would advertise a second
 * place to make the same check, and the whole point of a parse-time guard is that there is no
 * second place: nothing downstream should be re-deciding whether the base is safe.
 *
 * A RELATIVE VALUE IS REFUSED, not resolved. `new URL(value)` with no base throws for
 * `/relative/only` and for `not-a-url`, and the scheme test refuses `javascript:` and `mailto:`
 * — which parse fine and are exactly the shapes that must not reach an `href`.
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const DashboardConfigSchema = z.object({
  port: z.number().optional(),
  dbPath: z.string().optional(),
  artifactsDir: z.string().optional(),
  // Phase 387, D-10: where an entity card's `url` points. BOTH optional, so the v52 default
  // is a card with no `url` at all rather than a link to a route nothing serves. The card
  // producer reads these through the masked config reader and renders
  // `ENTITY_URL_ROUTE` (@vostride/agent-qa-schema) against them.
  //
  // They live on the EXISTING `services.dashboard` block rather than on a new top-level
  // `dashboard` key: this project already has one dashboard configuration home, and a second
  // one would be two places an operator could reasonably write the same fact.
  //
  // 2026-09-01 (Phase 408 plan 10, WR-04 — T-408-16): REFINED TO AN ABSOLUTE http(s) URL, because
  // this value stops being a display string in M5. It composes the tokenless live link
  // (`live-link.ts`'s `liveRunLinkOf`, which only strips trailing slashes), and that link is
  // assigned to an `href` INSIDE the served App document — which runs with `allow-scripts` at an
  // opaque origin — as well as appended verbatim to every carrier tool result's model-readable
  // text. A `javascript:` base therefore composed a script-executing anchor. The trust boundary is
  // the operator, so this is not remote-triggerable; the finding is that a URL-shaped value reached
  // an `href` with no scheme check at any hop, and the guard costs one refinement.
  //
  // AT THE PARSE BOUNDARY, so there is exactly one place that decides. The defensive drop at the
  // anchor itself is the SECOND half of the same finding and lives in `app-wrapper.ts`.
  //
  // STILL `.optional()`: an absent base is a real and honest posture — a standalone `agent-qa mcp`
  // with no dashboard — and the carrier result names that absence rather than fabricating a URL.
  // An EMPTY STRING is now REFUSED, which is stricter than before: `""` is not an absence an
  // operator wrote by leaving the key out, it is a value that composes a relative fragment reading
  // as a link and resolving against nothing.
  baseUrl: z.string().refine(
    isAbsoluteHttpUrl,
    { message: 'services.dashboard.baseUrl must be an absolute http(s) URL' },
  ).optional(),
  workspace: z.string().optional(),
  // Phase 402 D-05/D-06 (INVK-03): the authed run service's credential declarations, on the
  // EXISTING `services.dashboard` block for the reason stated above — this project already has one
  // dashboard configuration home, and the run service is mounted in the dashboard's own process
  // (D-02). The DTO is minted in `@vostride/agent-qa-schema` (384 D-16) and imported here.
  //
  // Default `[]` and not optional-undefined, on `services.mcp.tokens`'s own reasoning: "no tokens
  // declared" and "the key is absent" are the same fact, and a host that had to spell both would
  // be a host with a branch nobody tests. Absent means today's behavior exactly — no service
  // routes are mounted, and the dashboard runs as it does now.
  //
  // 2026-08-25 (Phase 403 D-14, WINDOWS #264): WHAT THIS FIELD GATES, EXACTLY — AND WHAT IT DOES
  // NOT. These entries authenticate the REMOTE run service and nothing else: `POST /run`,
  // `GET /run/:id/events`, `GET /run/:id/live-url` and `/ok`. Every LOCAL dashboard door is
  // credential-free by design and is kept local by the loopback bind guard below rather than by a
  // token — `GET /api/run-stream/:runId`, `GET /api/run-readiness`,
  // `GET /api/runs/:runId/live-url` and the `/live/` embed page all answer on a zero-token
  // dashboard, and 403 measured each of them there on the shipped binary.
  //
  // THE FAILURE THAT MAKES THIS WORTH WRITING DOWN: the local doors' session registry used to be
  // DERIVED off this field, so a default project with no credential declared answered 503 about
  // runs the very same process was executing (#264). `startServer` now takes `runServiceAttach`
  // as a first-class option supplied on BOTH arms. A local surface must never need a remote
  // credential, and a derivation is how one quietly starts to.
  runServiceTokens: z.array(RunServiceTokenEntrySchema).default([]),
  // Phase 402 D-07: the interface this server binds. Consumed by 402-05's pre-listen bind guard,
  // which REFUSES any non-loopback value — unconditionally since the phase-402 verification round
  // (a declared run-service credential authenticates the three run-service paths and nothing else,
  // so it was never evidence that the rest of this server's surface was authed).
  //
  // DELIBERATELY NOT `LoopbackHostSchema` even so. That schema refuses at PARSE time, which would
  // make the runtime refusal unreachable and would report the problem as a config-shape error
  // rather than as the security refusal it is — and it would also refuse a loopback SPELLING this
  // field exists to allow (`localhost`, `::1`, `127.0.0.2` is refused on purpose).
  host: z.string().trim().min(1).optional(),
}).strict()

/**
 * THE ONE MEMBER SET FOR "this host is loopback" (402-05 D-07 — T-402-18).
 *
 * Exported because two mechanisms now decide loopback membership and they must not be two
 * spellings: `LoopbackHostSchema` below refuses a non-loopback MCP host at PARSE time, and
 * `startServer`'s pre-listen bind guard refuses a non-loopback DASHBOARD host at RUNTIME, with no
 * exemption. A second literal list would let the two drift, and the direction it would drift in is
 * a host one mechanism calls loopback and the other does not.
 */
export const LOOPBACK_HOSTS: readonly string[] = Object.freeze(['localhost', '127.0.0.1', '::1'])

/** Whether a configured host names a loopback interface. The one predicate over the one set. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host.trim())
}

const LoopbackHostSchema = z.string().trim().min(1).refine(
  isLoopbackHost,
  { message: 'MCP host must be localhost, 127.0.0.1, or ::1 in local-only mode' },
)

// Phase 396 D-06/D-07: the per-caller credential declarations and the stdio grant opt-in land on
// the EXISTING `services.mcp` block rather than on a new top-level `mcp` key, for exactly the
// reason `services.dashboard` states two blocks above: this project already has one MCP
// configuration home, and a second one would be two places an operator could reasonably write the
// same fact. The DTOs themselves are minted in `@vostride/agent-qa-schema` (384 D-16) and imported
// here — the refs-only shape of a token entry is not re-declared in this package.
export const McpConfigSchema = z.object({
  enabled: z.boolean().optional(),
  transport: z.enum(['http', 'stdio']).optional(),
  host: LoopbackHostSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  path: z.string().trim().min(1).regex(/^\//, 'MCP path must start with /').optional(),
  // Default `[]` and not optional-undefined: "no tokens declared" and "tokens key absent" are the
  // same fact, and a host that had to spell both would be a host with a branch nobody tests.
  tokens: z.array(McpTokenEntrySchema).default([]),
  // `.prefault({})` rather than `.default({})` so the inner `grantConfigWrite: false` actually
  // materialises on an absent block — zod 4's `.default()` short-circuits without parsing, which is
  // the same trap the knowledge block above documents.
  stdio: McpStdioGrantSchema.prefault({}),
}).strict()

export const CacheConfigSchema = z.object({
  dir: z.string(),
  ttl: DurationString,
}).strict()

export const AuthStateConfigSchema = z.object({
  dir: z.string().trim().min(1),
}).strict()

export const LoggingConfigSchema = z.object({
  level: z.enum(['silent', 'error', 'warn', 'info', 'debug']),
}).strict()

export const RecordingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  keepFailuresOnly: z.boolean().optional(),
}).strict()

export const AccessibilityConfigSchema = z.object({
  enabled: z.boolean(),
  standard: z.enum(['wcag2a', 'wcag2aa', 'wcag2aaa']).optional(),
  runAfter: z.enum(['every-step', 'navigation', 'test-end']).optional(),
  failOnViolation: z.boolean().optional(),
  disableRules: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).strict()

export const VisionServiceSchema = z.object({
  screenshotSize: SizeString.optional(),
  effectiveResolution: z.number().positive().int().optional(),
}).strict()

export const ServicesSchema = z.object({
  dashboard: DashboardConfigSchema.optional(),
  mcp: McpConfigSchema.optional(),
  cache: CacheConfigSchema.optional(),
  authState: AuthStateConfigSchema.optional(),
  logging: LoggingConfigSchema.optional(),
  // Parse omitted containers too, while retaining optional authoring/input compatibility.
  recording: RecordingConfigSchema.prefault({}).optional(),
  accessibility: AccessibilityConfigSchema.optional(),
  vision: VisionServiceSchema.optional(),
}).strict()
