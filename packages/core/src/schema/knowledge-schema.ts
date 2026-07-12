import { z } from 'zod'

// D-10: pure string predicate only — no node:path import. Path resolution happens at
// composition roots; no resolver ships this phase (resolveKnowledgeRoot lands in Phase 374).
const isRepoRelative = (dir: string): boolean =>
  !/^[/\\]|^[A-Za-z]:[\\/]/.test(dir) && !/^\.\.(?:[/\\]|$)/.test(dir)

export const KnowledgeConfigSchema = z.object({
  dir: z.string().trim().min(1)
    .refine(isRepoRelative, {
      message: 'knowledge.dir must be repo-relative — the committed knowledge root must live inside the repo for PR review and the committed .gitignore split',
    })
    .default('agent-qa-knowledge'),
  // D-08: closed enum — deliberately no 'full' mode; full-res artifacts ride the
  // artifact store/git-LFS side channel per knowledge-store.md §5.
  commitArtifacts: z.enum(['none', 'thumbnails']).default('none'),
  // Absent = no cap: the engine's derived budget serves everything it ranks useful; when set
  // it is a hard ceiling min(cap, derived), clamped above min_brief — efficacy over token
  // saving (D-09, binds Phase 380 brief budgeting).
  contextBudgetTokens: z.number().int().positive().optional(),
}).strict()
