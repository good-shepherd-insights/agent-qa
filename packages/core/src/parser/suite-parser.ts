import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { SuiteDefinitionSchema } from '../schema/suite-schema.js'
import { yamlParseFailureMessage } from '../validation/yaml-fault.js'
import type { SuiteDefinition } from '../suite/types.js'

export async function parseSuiteFile(filePath: string): Promise<SuiteDefinition> {
  const content = await readFile(filePath, 'utf-8')

  let raw: unknown
  try {
    raw = parseYaml(content)
  } catch (err) {
    // WHERE, NEVER WHAT — the `run --suite` road (395-18, found by Task 2's enumeration).
    // This call had NO catch at all, so `yaml`'s pretty-printed throw travelled straight out of
    // `run.ts:1079`'s suite preflight and was reported as `Framework error: <the person's own
    // lines>`. Measured on the shipped binary carrying a planted credential before this arm
    // existed. `validateSuiteFile` — the SAME file class on the `validate` road — was hardened in
    // 395-16; this is its sibling one command over, which is the failure mode this codebase keeps
    // repeating.
    //
    // IT STILL THROWS. Turning it into a typed refusal is F-03's subject; only the message's
    // CONTENT changes here. The path is prefixed because the caller reports the message alone.
    // No `cause` is attached: a raw `YAMLParseError` hung on a thrown value is republished by
    // `util.inspect` and every printer built on it (395-16 · D-395-16-A).
    throw new Error(`${filePath}: ${yamlParseFailureMessage(err)}`)
  }

  return SuiteDefinitionSchema.parse(raw)
}
