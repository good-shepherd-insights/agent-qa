// The authoring brief as prompt blocks — ONE rendering, read by stage 3's two model calls.
//
// Stage 3 makes two calls (D-02 whole-document compile, then D-18's one refinement round) and both
// are given the same substrate in the same words. These renderers were private to `loop.ts` while
// there was one caller; they moved here when the second arrived, rather than being copied, because
// two renderings of one brief would let the refinement reason over a differently-worded view of the
// facts it is refining against — and a difference nobody intended is exactly what a second copy
// produces the first time either side is edited.
//
// WHAT A PROCEDURE CONTRIBUTES, AND WHAT IT MUST NOT (D-17 · T-394-38). `ProcedureMatch` carries
// `id`, a learned-shelf record id. This module reads `flowAnchor` and never `id`, so the vocabulary
// a step is authored in is the record's own words while the record's ADDRESS never reaches the
// model at all. That ordering is the whole mitigation: bytes a model was never shown are bytes it
// cannot paste into a committed test, and the authored shelf therefore carries nothing that
// supersession or garbage collection could later turn into a dangling reference.

import { procedureStepVocabulary } from '@vostride/agent-qa-schema'
import type { AuthoringBrief } from '@vostride/agent-qa-schema'

/**
 * The instruction that turns a served procedure into an ordinary step (D-17).
 *
 * Pinned as a constant for the reason {@link AUTHORING_COMPILE_AGENT_CONTEXT} is: it lands in the
 * stable prompt tier, which is the byte prefix a provider's prompt cache keys on, so a
 * per-invocation wording would defeat the caching the tier law exists to enable.
 *
 * It asks for PROSE and forbids a citation, which is the syntactic half of D-17 stated where a
 * model can read it. The semantic half is the vocabulary itself, rendered below.
 */
export const PROCEDURE_BY_REFERENCE_INSTRUCTION =
  'This project already knows how to perform some flows. Where a step of yours is one of the '
  + 'flows listed under PROCEDURE, write that step in that flow\'s own words, as an ordinary '
  + 'natural-language step. Do NOT cite a record, an id or a reference of any kind, and do not '
  + 'invent a special syntax: the test file stays plain prose, and the flow is recognised when the '
  + 'test runs. A step that matches no listed flow is simply written as you would write any other.'

/** The brief's exemplars, as the context block a model reads them as. */
export function exemplarBlockBody(brief: AuthoringBrief): string {
  if (brief.exemplars.length === 0) {
    return 'No exemplar tests were served for this scope. Follow the house YAML test style.'
  }
  return brief.exemplars
    .map((exemplar) => `- ${exemplar.filePath} · ${exemplar.testName}\n${exemplar.excerpt}`)
    .join('\n')
}

/**
 * The brief's cautions, procedures and facts, in the precedence the brief itself locked (ABRF-01).
 *
 * The procedure line renders {@link procedureStepVocabulary} over the flow anchor. The previous
 * form printed `JSON.stringify(flowAnchor)` for any arm that was not a flow, which put a serialized
 * object in front of a model asked to write English; the shared vocabulary function answers every
 * arm in the record's own words and cannot be handed an id to print.
 */
export function knowledgeBlockBody(brief: AuthoringBrief): string {
  const lines = [
    ...brief.cautions.map((caution) => `CAUTION: ${caution.summary}`),
    ...brief.procedures.map(
      (procedure) => `PROCEDURE: ${procedureStepVocabulary(procedure.flowAnchor)}`,
    ),
    ...brief.facts.map((fact) => `FACT: ${fact.summary}`),
  ]
  return lines.length === 0 ? 'This scope has no served knowledge yet.' : lines.join('\n')
}
