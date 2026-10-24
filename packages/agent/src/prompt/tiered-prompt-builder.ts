// The one tiered prompt builder (Phase 389, plan 03 — spec `qa-agent-and-surfaces.md` §1.4, D-04).
//
// THE TIER LAW. Every job prompt is three tiers assembled in one fixed order:
//
//   stable    role, output contract, invariant instructions — renders into `system`. These
//             bytes lead and never vary per run, so provider prompt caches see the same
//             prefix every call.
//   context   run-level facts — renders first into `prompt`.
//   volatile  per-test evidence packs — renders last into `prompt`.
//
// `agent_context` names the calling agent and purpose, and lands in the stable tier:
// analyze-run passes its own (plan 04); 392's chat passes chat's. That parameter — not a
// second builder, not a persona fork — is how the six job types share ONE prompt idiom
// (§1.4: "parameterized, not separate personas").
//
// THE 392-EXTENDS CONTRACT. This module ships the SHAPE and the renderer only. What goes in
// each tier — the analyze-run section content — is authored by the caller (plan 04 first,
// 392's chat after). A caller extends this builder by passing richer blocks, never by
// editing the assembly order or minting a sibling renderer; two prompt idioms is exactly
// the refactor D-04 exists to prevent.
//
// TEXT BY DESIGN. The output is the TEXT legs of `JobModelRequest` — `{system?, prompt}`.
// D-02's capability-gated screenshot channel rides the request's optional images leg,
// attached by the AUTHOR at request assembly (plan 04): image parts are evidence payload,
// not tier prose, so the renderer has no image awareness and 392 inherits a clean text
// contract.
//
// Deterministic by construction: pure string assembly over the inputs, no clock, no
// randomness, no host APIs — identical tier inputs produce byte-identical output.

import type { JobModelRequest } from '../jobs/record-llm-authorship.js'

/**
 * One named section inside a tier. `title` renders as a `##` header; `body` is the
 * caller's prose, carried verbatim.
 */
export interface PromptTierBlock {
  readonly title: string
  readonly body: string
}

export interface TieredPromptInput {
  /** Who is asking and why — stable-tier provenance (§1.4's `agent_context` parameter). */
  readonly agent_context: string
  /** Invariant instructions: role, output contract. Renders into `system`. */
  readonly stable: readonly PromptTierBlock[]
  /** Run-level facts. Renders into `prompt`, before the volatile tier. */
  readonly context: readonly PromptTierBlock[]
  /** Per-test evidence. Renders into `prompt`, last — the cache-hostile bytes trail. */
  readonly volatile: readonly PromptTierBlock[]
}

/** The stable separator between rendered blocks — one blank line, never accumulated. */
const BLOCK_SEPARATOR = '\n\n'

function renderBlock(block: PromptTierBlock): string {
  return `## ${block.title}${BLOCK_SEPARATOR}${block.body}`
}

/**
 * Assemble the three tiers into the text legs of a `JobModelRequest`.
 *
 * An empty tier contributes zero bytes — no dangling header, no trailing separator —
 * because blocks are joined, never appended, so structure exists only where content does.
 */
export function buildTieredPrompt(input: TieredPromptInput): JobModelRequest {
  const system = [
    `Agent context: ${input.agent_context}`,
    ...input.stable.map(renderBlock),
  ].join(BLOCK_SEPARATOR)

  const prompt = [...input.context.map(renderBlock), ...input.volatile.map(renderBlock)].join(
    BLOCK_SEPARATOR,
  )

  return { system, prompt }
}
