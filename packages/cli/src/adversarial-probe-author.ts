/**
 * 422 D-10: the ONE place a probe author model comes into existence.
 *
 * `createModel` is reached here, inside `runSafetyScope`, and what leaves this file is a
 * `ProbeAuthorPort` and nothing else. eval-local's sanctioned `createModel` site count stays at
 * one because the staging composition never sees a profile, a credential or a provider name —
 * it sees one method that takes a pure DTO and returns text plus usage.
 *
 * WHAT IS DURABLE AT THE MOMENT OF INVOCATION: NOTHING THIS FILE WRITES. 422-03's refresh record
 * deliberately carries no pre-work row because derivation and scanning are PURE — an interrupted
 * run simply recomputes them. A provider call is not pure: a response that arrives after the
 * process dies is paid for and lost, and re-running the same request pays again. This binding
 * therefore announces every attempt through `onCallAttempted` BEFORE it constructs a model or
 * sends anything, so the layer that owns durability (422-06, which also owns the call cap) can
 * make the spend recoverable at the one instant where that is still possible. An input that
 * omits the hook is making a choice: unreserved spend, recoverable only by the operator noticing.
 *
 * MODEL-AUTHORED TEXT IS UNTRUSTED DATA ON THE WAY BACK, TOO. The response is parsed against the
 * frozen prompt's one-field shape and nothing else; a response that is not that shape is refused
 * with a message that quotes NONE of it. The same rule covers identities: a configured model id
 * can itself embed a credential, so no refusal on this path spells a model id out either.
 */
import { generateText } from 'ai'
import { z } from 'zod'
import type { RunExecutionContext, RunMaskingContext } from '@vostride/agent-qa-agent-local'
import {
  createModel, JsonlAuditSink, runSafetyScope, renderAdversarialProbePrompt,
  type GenerationRequest, type ProbeAuthorPort, type ProbeGeneratorKind, type ProbeText,
} from './eval-session-composition.js'
import type { AdversarialProbeAuthorSelection } from './adversarial-probe-preflight.js'

/**
 * Output ceiling for one authored probe.
 *
 * A stated bound rather than a tuned one, and deliberately the same order as the contract's own
 * `PROBE_MAX_TEXT_LENGTH`: the thing being authored is a control label wrapped in a one-field
 * JSON object, so a response that needs more than this is prose the model wrote around the
 * answer — which `deriveProbeCassette` would refuse anyway, after paying for it.
 */
export const PROBE_AUTHOR_MAX_OUTPUT_TOKENS = 200

/** A probe call that has not answered inside this window is abandoned rather than awaited. */
export const PROBE_AUTHOR_TIMEOUT_MS = 20_000

/** The frozen prompt's return contract: exactly one field, and strictly that one. */
const AUTHORED_NAME = z.object({ name: z.string() }).strict()

/**
 * What the port announces before it spends.
 *
 * Deliberately the IDEMPOTENCE key of D-11 (`seed`, `kind`, `promptVersion`) plus the author's
 * identity — everything a durable reservation needs to recognise its own attempt on restart, and
 * nothing that carries a credential.
 */
export interface ProbeCallAttempt {
  seedCassetteId: string
  kind: ProbeGeneratorKind
  promptVersion: number
  authoringModelId: string
}

export interface AdversarialProbeAuthorInput {
  /** The preflight's choice. Carries credentials; never serialized by anything here. */
  author: AdversarialProbeAuthorSelection
  executionContext: RunExecutionContext
  /** A fresh, disposable masker per call — the session's own factory, never a copy. */
  maskingContextFactory: () => RunMaskingContext
  auditDir: string
  /**
   * Called BEFORE the model is constructed and before anything is sent. A throw refuses the
   * call, and the refusal is the point: this is where a cap or a durable reservation belongs.
   */
  onCallAttempted?: (attempt: ProbeCallAttempt) => void | Promise<void>
  /** Focused test seams. Production callers omit both. */
  createModelImpl?: typeof createModel
  generateTextImpl?: typeof generateText
}

/**
 * Bind the selected author as a `ProbeAuthorPort`.
 *
 * The port answers for ONE identity — the selected author's. A request stamped with any other
 * authoring model is refused rather than answered, because the entry derived from the response
 * stamps the request's author: answering would make a committed corpus entry credit a model that
 * did not write the text it names.
 */
export function createAdversarialProbeAuthor(
  input: AdversarialProbeAuthorInput,
): ProbeAuthorPort {
  const { author } = input
  const create = input.createModelImpl ?? createModel
  const generate = input.generateTextImpl ?? generateText

  return {
    async author(request: GenerationRequest): Promise<ProbeText> {
      if (request.authoringModel.id !== author.authoringModel.id) {
        throw new Error('This probe author is bound to a different authoring model than the request names.')
      }
      await input.onCallAttempted?.({
        seedCassetteId: request.seedCassetteId,
        kind: request.kind,
        promptVersion: request.promptVersion,
        authoringModelId: author.authoringModel.id,
      })

      // A copy, so a caller's profile object cannot be mutated underneath a bound model.
      const profile = {
        ...author.profile,
        ...(author.profile.capabilities === undefined
          ? {}
          : { capabilities: { ...author.profile.capabilities } }),
      }
      const maskingContext = input.maskingContextFactory()
      try {
        return await runSafetyScope({
          maskingContext,
          auditSink: new JsonlAuditSink(input.auditDir),
          executionContext: input.executionContext,
        }, async () => {
          const model = create(profile, author.auth)
          const prompt = renderAdversarialProbePrompt(request)
          const result = await generate({
            model,
            maxRetries: 0,
            temperature: 0,
            maxOutputTokens: PROBE_AUTHOR_MAX_OUTPUT_TOKENS,
            abortSignal: AbortSignal.timeout(PROBE_AUTHOR_TIMEOUT_MS),
            system: prompt.system,
            prompt: prompt.user,
          })
          const parsed = AUTHORED_NAME.safeParse(parseJson(result.text))
          if (!parsed.success) {
            throw new Error('The probe author returned a response that is not the single-field name object the frozen prompt requires.')
          }
          return {
            text: parsed.data.name,
            // Reported spend, carried as reported -- and ABSENT when the provider reported
            // nothing, never zero. A zero here would be a measured claim about a call whose
            // cost we do not know, and the disclosure that reads this cannot tell the two
            // apart once they are the same number. The probe budget is denominated in CALLS
            // for exactly this reason, so an unreported token still never buys an extra call.
            usage: {
              ...(reportedCount(result.usage?.inputTokens) === undefined
                ? {}
                : { promptTokens: reportedCount(result.usage?.inputTokens) }),
              ...(reportedCount(result.usage?.outputTokens) === undefined
                ? {}
                : { completionTokens: reportedCount(result.usage?.outputTokens) }),
            },
          }
        })
      } finally { maskingContext.dispose() }
    },
  }
}

/** Never throws with the payload in the message — an unparseable body is data, not a diagnostic. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** A count the provider actually reported, or `undefined` when it reported nothing usable. */
function reportedCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined
}
