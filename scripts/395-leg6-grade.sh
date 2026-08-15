#!/usr/bin/env bash
# LEG 6's VERDICT PREDICATE — one producer, two callers (395-28 · CR-04 / I-01).
#
# WHY THIS IS A FILE AND NOT A BRANCH IN THE LANE. Until 395-28 LEG 6 graded itself inline, and the
# grading asserted two facts it never measured: its PASS sentence stated *"The prompt was DECLINED,
# and the repository is untouched: commits X -> Y"* while `declined` was emitted on the driver's
# verdict line and never read, and the two commit counts were captured and never compared. A leg that
# states an unmeasured fact inside a PASS converts an ABSENCE of measurement into a PRESENCE of
# proof, and a release reads that verdict.
#
# The refusals are the fix; the EXTRACTION is what makes the fix checkable. `395-leg6-instrument-
# check.sh` sources THIS file and drives THIS function with injected measurements, so the grading
# proven falsifiable is the grading the lane actually uses. A re-typed copy in the check would
# measure a sibling — the failure mode this phase has now named in five separate instruments.
#
# THE THREE HONEST SKIPS ARE UNTOUCHED. A driver that is absent, a headless refusal with a known
# cause, and a single drive on which the planner never reached the prompt are absences, not
# failures, and their sentences below are byte-identical to the ones the lane carried before the
# extraction — only the leg-local variable names became parameter names.
#
# usage:  source 395-leg6-grade.sh ; leg6_grade <args...> ; then read $L6_GRADE_VERDICT/$L6_GRADE_WHY

L6_GRADE_VERDICT=''
L6_GRADE_WHY=''

# leg6_grade <verdict_line> <prompt_at> <summary_at> <files_at> <diff_at> <declined> <timedout> \
#            <commits_before> <commits_after> <transcript> <known_cause>
#
# Every argument is a MEASUREMENT. Nothing in here reads the filesystem or the process table: the
# caller measures, this function grades, and that split is what lets the check drive it.
leg6_grade() {
  local verdict_line="$1" prompt_at="$2" summary_at="$3" files_at="$4" diff_at="$5"
  local declined="$6" timedout="$7" commits_before="$8" commits_after="$9"
  local transcript="${10}" known_cause="${11}"

  if [ -z "$verdict_line" ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="the pty drive produced no verdict line at all — no reading was taken. Transcript: $transcript"

  # REFUSAL 1 — THE REPOSITORY COMPARISON LEG 3 ALREADY MAKES (395-28 · CR-04). A commit count that
  # moved is RED whatever else the offsets say: this leg declines the approval on purpose, so a
  # repository that changed anyway means the decline did not hold, and no ordering result is worth
  # anything beside that. LEG 3 does exactly this with `L3_MUTATED`; LEG 6 did not.
  elif [ "$commits_after" != "$commits_before" ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="A DECLINED APPROVAL MUTATED THE REPOSITORY: commits $commits_before -> $commits_after. The leg's whole premise is that declining leaves the project alone, so this is the finding and the ordering offsets (prompt=$prompt_at summary=$summary_at files=$files_at diff=$diff_at) are beside it. Transcript: $transcript"

  # REFUSAL 2 — A WEDGED DRIVE IS A FAILED MEASUREMENT, NOT AN ABSENT ONE (395-28 · CR-04). Before
  # this round the driver called `waitpid` with `WNOHANG`, which reports status 0 for a child that
  # has NOT exited; a hang printed a clean-exit verdict with prompt=-1, the shell recorded SKIP, and
  # SKIP does not set the lane's return code. A hang therefore produced a GREEN lane and a leaked
  # child. It is RED, and it is checked ABOVE the prompt-absence skips because a hang has no prompt.
  elif [ "$timedout" = '1' ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="THE DRIVE WEDGED AND WAS KILLED ON THE DEADLINE — no reading was taken, and that is a FAILED measurement rather than an absent one. Until 395-28 this shape reported SKIP (which does not set the lane's return code) while the driver leaked the child. Offsets at the kill: prompt=$prompt_at summary=$summary_at files=$files_at diff=$diff_at. Transcript: $transcript"

  elif [ "${prompt_at:--1}" -lt 0 ] && [ "$known_cause" = '1' ]; then
    L6_GRADE_VERDICT='SKIP'
    L6_GRADE_WHY="THE ASK ROAD CANNOT PLAN AT ALL, AND THAT IS THIS DRIVE'S FINDING — measured, not inferred. In the SAME project shape LEG 3 drives (a real config carrying \`registry.llms\`, zero targets), \`agent-qa chat\` binds \`gpt-5.6-terra\` and routes; \`agent-qa ask\` answered *'No capability in this build handles: \"write a test for booking.com checkout\"'* — the D-08 headless refusal. \`chat.ts:253\` resolves \`resolveCliChatCapabilities\` and passes \`chatModel\`/\`chatModelFor\`/\`chatAccounting\`; \`ask.ts\` passes NONE of them, so the composition is headless and no \`authoring.draft.write\` is ever planned. CONSEQUENCE FOR 395-VERIFICATION's CR-03: its drive substituted a \`chatModel\` the shipped verb does not bind, so the blind confirm it measured is not reachable through \`agent-qa ask\` AS SHIPPED — the finding's mechanism is real and its \`ask\`-surface reachability premise was itself unmeasured. 395-22 closes the mechanism anyway at the choke point (\`turn-engine.ts\`'s displayability precondition, covering every host) and binds \`chatPresent\` here so the render is in place the day the model binding is. NOT SILENTLY WIDENED: binding a chat model on \`ask\` would make a gated in-turn apply reachable from a verb that today cannot reach it, which is a scope call for the owner and not for this plan. THE RESIDUAL BOUND: the ask road's render-before-prompt ordering is held hermetically by (A1)/(A2) in packages/cli/src/composition/__tests__/ask-present-road.test.ts — (A2) pins zero confirm invocations with no port bound, (A1) pins the render event strictly before the confirm spy's first call with it bound — over the SAME production composition and the same op. Transcript: $transcript"

  elif [ "${prompt_at:--1}" -lt 0 ]; then
    L6_GRADE_VERDICT='SKIP'
    L6_GRADE_WHY="NO APPROVAL PROMPT WAS REACHED ON THIS SINGLE DRIVE, so the ordering has nothing to be measured against — the live planner did not route this utterance to \`write_test\` (its known k=1 nondeterminism, the same SC-5's own lane lives with), or the turn refused for a reason the branch above does not recognise. THE RESIDUAL BOUND, STATED: the ask road's render-before-prompt ordering is held hermetically by (A1)/(A2) in packages/cli/src/composition/__tests__/ask-present-road.test.ts — (A2) pins zero confirm invocations with no port bound, (A1) pins the render event strictly before the confirm spy's first call with it bound — over the SAME production composition and the same op. Live k=1 did not add to it this run. Transcript: $transcript"

  elif [ "${summary_at:--1}" -ge 0 ] && [ "${summary_at}" -lt "${prompt_at}" ] \
    && [ "${files_at:--1}" -ge 0 ] && [ "${files_at}" -lt "${prompt_at}" ] \
    && [ "${diff_at:--1}" -ge 0 ] && [ "${diff_at}" -lt "${prompt_at}" ]; then

    # REFUSAL 3 — THE PASS SENTENCE CLAIMS A DECLINE, SO THE DECLINE IS A CONDITION OF THE VERDICT
    # (395-28 · CR-04). `declined` was on the verdict line from the day the driver was written and
    # was never read. An ordering that is correct while the prompt went unanswered is not this leg's
    # PASS: the render-before-prompt fact would be real, but the sentence stating it would also
    # state a decline that did not happen, and the repository comparison above would be vacuous.
    if [ "$declined" = '1' ]; then
      L6_GRADE_VERDICT='PASS'
      L6_GRADE_WHY="SC-5's FIRST CLAUSE, MEASURED ON THE SHIPPED ONE-SHOT VERB. On a real terminal, over a live planner, the person was shown the proposal's summary line (byte $summary_at), the config file it touches (byte $files_at) and a true unified-diff hunk (byte $diff_at) — all STRICTLY BEFORE the approval prompt at byte $prompt_at. Round 4 measured this same road carrying exactly one line before the decision, the prompt itself. The prompt was DECLINED, and the repository is untouched: commits $commits_before -> $commits_after."
    else
      L6_GRADE_VERDICT='RED'
      L6_GRADE_WHY="THE PROMPT WAS NEVER ANSWERED, so this leg did not measure what its PASS sentence would have claimed. The render markers DID land before the prompt (summary=$summary_at files=$files_at diff=$diff_at, prompt=$prompt_at), but the driver reports declined=$declined — the decline is what makes the commit comparison above mean anything, so without it there is no PASS to award. Transcript: $transcript"
    fi

  else
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="THE CR-03 STATE, ON A SHIPPED SURFACE: an approval prompt at byte $prompt_at with the render markers at summary=$summary_at files=$files_at diff=$diff_at — a person was asked to approve a configuration change they were not shown, or were shown it only afterwards. Transcript: $transcript"
  fi
}
