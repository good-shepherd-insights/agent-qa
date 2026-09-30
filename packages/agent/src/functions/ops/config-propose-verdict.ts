// The clause verdicts for the config answers — one union, one fold each (399.1-03 · D-01/D-02).
//
// 2026-09-30, 432-11 D-05: six of the seven ops now answer `ConfigChangeOutput`, what they wrote in
// the call, and fold through `classifyConfigChangeOutput`. `config.undo.propose` still answers
// `ConfigProposeOutput` until 432-17 deletes it.
//
// SEVEN OPS ANSWER WITH THIS UNION and there is exactly one fold over it, because seven copies of
// one mapping is the drift this project refuses everywhere else it has a shared vocabulary: a later
// edit that taught `config.target.create` to report a guardrail block as `refused` and left
// `config.auth.set` reporting `executed` would be a security control that works on some doors. The
// arms belong to `ConfigProposeOutputSchema`, so the fold over them belongs beside it too — not
// inside whichever op happened to need it first.
//
// IT READS DISCRIMINANTS AND THE ARM'S OWN NAMED REASON, AND NOTHING ELSE. D-01 rejected chat-side
// value-pattern matching by name — "a rule that can only refuse what it can NAME cannot be driven to
// zero by naming more things" — and a fold that sniffed strings out of a payload would be that same
// door-enumeration failure moved one file over. `refusal-classifiers.test.ts` scans this file's
// executable text for every value-inspecting operator and requires none.
//
// IT DECIDES NOTHING. The gate has run, the op has run, the audit row is written. This is the
// REPORT, and its only job is to stop the report saying `executed` over a refusal.

import type { ConfigChangeOutput, ConfigProposeOutput } from '@vostride/agent-qa-schema'

import type { ClauseVerdict } from '../spec.js'

/**
 * Fold one `ConfigProposeOutput` into the verdict its own arm states.
 *
 * FOUR ARMS, THREE VERDICTS. `blocked` is the arm G-399-2 caught reporting `executed` in green: the
 * guardrail refused to write a secret into the config, the file was byte-unchanged, and chat told
 * the person the mutation completed. It is `refused` — the control WORKED — and the reason
 * (`guardrail-hit` distinguishing "you tried to write a secret" from `schema-fail`'s "your config is
 * invalid") is what the outcome carries. `refused` is the op's OWN refusal arm and folds the same
 * way for the same reason: the request was declined before anything was proposed.
 *
 * `proposed` IS `executed`, AND `no-change` IS TOO. A proposal really was filed — filing one is the
 * whole job — and a set of a value the config already holds is neither an error nor a refusal.
 *
 * NOTHING IS DERIVED FROM THROW-VS-RETURN HERE, and that asymmetry is RC-1b's actual defect: all
 * four arms RETURN, which is exactly why the engine could not tell them apart. A thrown error is
 * still `failed` and still the engine's own mapping — this fold never sees one.
 */
export function classifyConfigProposeOutput(output: ConfigProposeOutput): ClauseVerdict {
  switch (output.outcome) {
    case 'blocked':
      return { status: 'refused', outcome: output.blockedReason }
    case 'refused':
      return { status: 'refused', outcome: output.reason }
    case 'no-change':
      return { status: 'executed', outcome: `no change: ${output.path} already holds that value` }
    case 'proposed':
      return { status: 'executed', outcome: `proposed ${output.proposalId}` }
  }
}

/**
 * Fold one `ConfigChangeOutput` into the verdict its own arm states (432-11 D-05/D-07).
 *
 * `applied` and `no-change` are `executed`: the file holds the change. `blocked` and `refused` are
 * `refused`, with their own reason, and nothing was written. `interrupted` is `failed`: some files
 * hold the change and one did not, so success is the one thing this report must not say.
 */
export function classifyConfigChangeOutput(output: ConfigChangeOutput): ClauseVerdict {
  switch (output.outcome) {
    case 'applied':
      return { status: 'executed', outcome: `applied: ${output.files.join(', ')}` }
    case 'no-change':
      return { status: 'executed', outcome: `no change: ${output.path} already holds that value` }
    case 'blocked':
      return { status: 'refused', outcome: output.blockedReason }
    case 'refused':
      return { status: 'refused', outcome: output.reason }
    case 'interrupted':
      return { status: 'failed', outcome: `interrupted at ${output.failed.path}: ${output.failed.reason}` }
  }
}
