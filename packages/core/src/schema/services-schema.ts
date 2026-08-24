import { z } from 'zod'
import {
  McpStdioGrantSchema,
  McpTokenEntrySchema,
  RunServiceTokenEntrySchema,
} from '@vostride/agent-qa-schema'
import { DurationString, SizeString } from './primitives.js'

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
  baseUrl: z.string().optional(),
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
  runServiceTokens: z.array(RunServiceTokenEntrySchema).default([]),
  // Phase 402 D-07: the interface this server binds. Consumed by 402-05, which makes an explicit
  // non-loopback bind REFUSE startup unless token auth is configured.
  //
  // DELIBERATELY NOT `LoopbackHostSchema`. That schema refuses a non-loopback value at PARSE time,
  // which would make D-07's refusal unreachable and would also refuse the one configuration D-07
  // exists to permit: a non-loopback bind WITH declared tokens. The loopback default and the
  // structural refusal both live at the bind, where the token list is in scope.
  host: z.string().trim().min(1).optional(),
}).strict()

/**
 * THE ONE MEMBER SET FOR "this host is loopback" (402-05 D-07 — T-402-18).
 *
 * Exported because two mechanisms now decide loopback membership and they must not be two
 * spellings: `LoopbackHostSchema` below refuses a non-loopback MCP host at PARSE time, and
 * `startServer`'s pre-listen bind guard refuses a non-loopback DASHBOARD host at RUNTIME unless a
 * run-service credential is declared. A second literal list would let the two drift, and the
 * direction it would drift in is a host one mechanism calls loopback and the other does not.
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
  enabled: z.boolean().optional(),
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
  recording: RecordingConfigSchema.optional(),
  accessibility: AccessibilityConfigSchema.optional(),
  vision: VisionServiceSchema.optional(),
}).strict()
