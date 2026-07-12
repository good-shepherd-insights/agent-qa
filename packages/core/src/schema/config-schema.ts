import { z } from 'zod'
import { WorkspaceSchema } from './workspace-schema.js'
import { ServicesSchema } from './services-schema.js'
import { KnowledgeConfigSchema } from './knowledge-schema.js'
import { RegistrySchema } from './registry-schema.js'
import { MobileAppStateSchema, UseSchema } from './use-schema.js'
import { AnalyticsSchema } from './analytics-schema.js'

export const AuthPluginDeclarationSchema = z.union([
  z.object({
    package: z.string().trim().min(1),
  }).strict(),
  z.object({
    path: z.string().trim().min(1),
  }).strict(),
])

// Provider plugins load in-process with full Node access; keep them first-party-only
// until a container sandbox exists.
export const ProviderPluginDeclarationSchema = z.union([
  z.object({
    package: z.string().trim().min(1),
  }).strict(),
  z.object({
    path: z.string().trim().min(1),
  }).strict(),
])

export const PluginsSchema = z.object({
  auth: z.array(AuthPluginDeclarationSchema).optional().default([]),
  providers: z.array(ProviderPluginDeclarationSchema).optional().default([]),
}).strict()

export const AgentQaConfigSchema = z.object({
  workspace: WorkspaceSchema,
  services: ServicesSchema.optional(),
  // D-08: slim replacement for the retired services.memory surface; prefaulted so parsed
  // configs always materialize knowledge defaults (zod 4 .default() short-circuits without
  // parsing — .prefault() runs the inner defaults) — matches the providers `.default([])`
  // precedent in spirit.
  knowledge: KnowledgeConfigSchema.prefault({}),
  registry: RegistrySchema.optional(),
  use: UseSchema.optional(),
  plugins: PluginsSchema.optional(),
  analytics: AnalyticsSchema.optional(),
  // D-15 config half: explicit opt-in trusted-ask mode (the CLI flag half is plan 362-06).
  // Strict so unknown safety subkeys are rejected — no implicit/unscoped trust channel (§2.3).
  safety: z.object({ trustMode: z.boolean().optional() }).strict().optional(),
  // D-03 (Phase 372): eval substrate params. `judge` references a NAMED registry.llms entry;
  // strict so unknown eval subkeys are rejected.
  eval: z.object({
    judge: z.string().optional(),
    // Owner override of D-10 (2026-07-12): explicit default-off opt-in that lets a
    // KNOWN-same-family judge run; the eligibility law discloses the override on every
    // scored entry (familyOverride) and the report projection renders one honesty line.
    // Unknown families stay forbidden regardless.
    judgeAllowSameFamily: z.boolean().optional(),
    k: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    seeding: z.object({
      silverPerTestCap: z.number().int().positive().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict()
.superRefine((val, ctx) => {
  const llms = val.registry?.llms ?? []
  const names = llms.map(c => c.name)
  const dupes = names.filter((n, i) => names.indexOf(n) !== i)
  for (const dupe of new Set(dupes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['registry', 'llms'],
      message: `Duplicate LLM config name: "${dupe}"`,
    })
  }
  if ((val.use as any)?.platform) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['use', 'platform'],
      message: 'use.platform cannot be set at global config level. Set platform in test or suite YAML instead.',
    })
  }
  if (val.use?.llm && !names.includes(val.use.llm)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['use', 'llm'],
      message: `use.llm "${val.use.llm}" does not match any name in registry.llms`,
    })
  }
  if (!MobileAppStateSchema.safeParse(val.use?.mobile?.appState).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['use', 'mobile', 'appState'],
      message: 'use.mobile.appState is required and must be one of: preserve | reset',
    })
  }
})

export { WorkspaceSchema } from './workspace-schema.js'
export { AuthStateConfigSchema, ServicesSchema } from './services-schema.js'
export { KnowledgeConfigSchema } from './knowledge-schema.js'
export { RegistrySchema } from './registry-schema.js'
export {
  AuthStateUseSchema,
  MobileAppStateSchema,
  MobileUseSchema,
  MobileUseOverrideSchema,
  UseSchema,
  UseOverrideSchema,
  normalizeAuthStateUse,
  type NormalizedAuthStateUse,
} from './use-schema.js'
export { AnalyticsSchema } from './analytics-schema.js'
export * from './primitives.js'
