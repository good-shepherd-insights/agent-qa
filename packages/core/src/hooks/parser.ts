import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { HooksFileSchema } from './schema.js'
import { yamlParseFailureMessage } from '../validation/yaml-fault.js'
import type { HookDefinition } from '@vostride/agent-qa-runner'

export async function parseHooksFile(filePath: string): Promise<{ hooks: HookDefinition[]; errors: string[] }> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (err) {
    return { hooks: [], errors: [`Failed to read hooks file: ${(err as Error).message}`] }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err) {
    // WHERE, NEVER WHAT — the SIBLING MEMBER of the set the config arm was hardened on
    // (395-16 · CR-02). `hooks.yaml` is a member of the same file set `enumerateConfigFileSet`
    // pins, and this line used to interpolate the caught error's own text: `yaml` pretty-prints a
    // parse error with a verbatim excerpt of the source around the point it gave up, measured
    // carrying a planted credential out of `agent-qa validate`'s rendered output. One member
    // hardened while its sibling leaks is this codebase's recurring failure mode, so this arm
    // composes through the SAME core primitive the config arm uses — two spellings of one sentence
    // are two things that can drift apart. The path prefix is deliberate: these strings travel to
    // consumers (run.ts, the dashboard registry road) that do not separately name the file.
    return { hooks: [], errors: [`${filePath}: ${yamlParseFailureMessage(err)}`] }
  }

  const result = HooksFileSchema.safeParse(parsed)
  if (!result.success) {
    const errors = result.error.issues.map((issue) =>
      `${issue.path.join('.')}: ${issue.message}`
    )
    return { hooks: [], errors }
  }

  const dir = dirname(filePath)
  const hooks: HookDefinition[] = result.data.hooks.map((h) => ({
    ...h,
    file: resolve(dir, h.file),
    deps: h.deps.map((d) => resolve(dir, d)),
    packageFile: h.packageFile ? resolve(dir, h.packageFile) : undefined,
  }))

  return { hooks, errors: [] }
}
