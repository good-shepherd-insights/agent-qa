import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { slugBranch } from '@vostride/agent-qa-schema'

/**
 * D-07: Provisional authored-policy warning threshold. This is an operator
 * signal only, never a serving budget or user-facing configuration key.
 */
const POLICY_SIZE_WARNING_CHARACTERS = 16_000

export interface OversizedPolicy {
  file: string
  approxTokens: number
}

export interface PolicyLadder {
  text: string
  files: string[]
  oversized: OversizedPolicy[]
}

interface PolicyRung {
  file: string
  text: string
}

function readOptionalPolicy(knowledgeRoot: string, file: string): PolicyRung | undefined {
  try {
    return {
      file,
      text: readFileSync(join(knowledgeRoot, ...file.split('/')), 'utf8'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function renderPolicyLadder(rungs: readonly PolicyRung[]): string {
  if (rungs.length === 0) return ''

  let rendered = rungs[0]!.text
  for (const rung of rungs.slice(1)) {
    const leadingNewline = rendered.length > 0 && !rendered.endsWith('\n') ? '\n' : ''
    rendered += `${leadingNewline}--- POLICY SOURCE: ${rung.file} ---\n${rung.text}`
  }
  return rendered
}

export function readPolicyLadder(
  knowledgeRoot: string,
  product?: string,
): PolicyLadder {
  // D-06: The ladder is deliberately closed at two rungs, general before specific.
  const requestedFiles = ['policies/global.md']
  if (product !== undefined && product.length > 0) {
    // Product identity is data, not a caller-controlled path. Reuse the shared
    // path-segment sanitizer so a product cannot escape the authored shelf.
    requestedFiles.push(`policies/${slugBranch(product)}.md`)
  }

  const rungs = requestedFiles.flatMap((file) => {
    const rung = readOptionalPolicy(knowledgeRoot, file)
    return rung === undefined ? [] : [rung]
  })

  return {
    // D-07: Policy bytes are concatenated whole. Labels frame sources but no
    // policy text is summarized, truncated, normalized, or reflowed.
    text: renderPolicyLadder(rungs),
    files: rungs.map(({ file }) => file),
    oversized: rungs.flatMap(({ file, text }) =>
      text.length > POLICY_SIZE_WARNING_CHARACTERS
        ? [{ file, approxTokens: Math.ceil(text.length / 4) }]
        : [],
    ),
  }
}
