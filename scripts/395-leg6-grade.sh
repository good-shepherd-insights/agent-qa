#!/usr/bin/env bash
# LEG 6's VERDICT PREDICATE — one producer, two callers (395-28 · CR-04 / I-01).
#
# WHY THIS IS A FILE AND NOT A BRANCH IN THE LANE. Until 395-28 LEG 6 graded itself inline, and the
# grading asserted facts it never measured. The EXTRACTION is what makes the grading checkable:
# `395-leg6-instrument-check.sh` sources THIS file and drives THIS function with injected
# measurements, so the grading proven falsifiable is the grading the lane actually uses.
#
# 2026-10-02 (Phase 432 plan 41, D-14/D-23): THE ASK ROAD HAS NO PROMPT. `agent-qa ask` writes the
# scaffold in its own call and shows the change it made; nothing asks and nothing can be declined
# (C432-CLI-ONE-CALL; `ask-present-road.test.ts` (A1)/(A2)). The old PASS — summary, files and diff
# all rendered BEFORE the approval prompt, and the prompt declined — has no subject any more, and the
# `declined` argument is replaced by the child's real exit `status`. What this grades now:
#
#   RED   no verdict line; a Git commit appeared (the product makes none); the drive wedged; a RETIRED
#         approval prompt rendered at all (the D-14 regression); nothing rendered and a non-zero exit
#         that is not the known headless refusal (a crash, or a launch failure 126/127); a partial
#         render; a full render with a non-zero exit.
#   SKIP  no render at all — the known headless refusal, or the live planner not routing this one
#         utterance (its k=1 nondeterminism) with exit 0. Each SKIP names the hermetic cells that
#         hold the road.
#
# 2026-10-03 (quick-261003-tsr, WR-13): a nothing-rendered, non-zero exit used to grade SKIP and
# blame the planner, so a crashed or unlaunchable `ask` left the lane green.
#   PASS  no prompt, the summary line, the config file and a unified-diff hunk on the terminal, exit
#         0, and no Git commit.
#
# usage:  source 395-leg6-grade.sh ; leg6_grade <args...> ; then read $L6_GRADE_VERDICT/$L6_GRADE_WHY

L6_GRADE_VERDICT=''
L6_GRADE_WHY=''

# leg6_grade <verdict_line> <prompt_at> <summary_at> <files_at> <diff_at> <status> <timedout> \
#            <commits_before> <commits_after> <transcript> <known_cause>
#
# Every argument is a MEASUREMENT. Nothing in here reads the filesystem or the process table: the
# caller measures, this function grades, and that split is what lets the check drive it.
leg6_grade() {
  local verdict_line="$1" prompt_at="$2" summary_at="$3" files_at="$4" diff_at="$5"
  local status="$6" timedout="$7" commits_before="$8" commits_after="$9"
  local transcript="${10}" known_cause="${11}"
  local hermetic='the ask road is held hermetically by (A1)/(A2) in packages/cli/src/composition/__tests__/ask-present-road.test.ts — (A2) a headless ask configures and authors with nothing asked, (A1) a bound surface is shown the change after it was written — over the SAME production composition and the same op'
  local rendered=0
  [ "${summary_at:--1}" -ge 0 ] && rendered=$((rendered + 1))
  [ "${files_at:--1}" -ge 0 ] && rendered=$((rendered + 1))
  [ "${diff_at:--1}" -ge 0 ] && rendered=$((rendered + 1))

  if [ -z "$verdict_line" ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="the pty drive produced no verdict line at all — no reading was taken. Transcript: $transcript"

  # THE REPOSITORY COMPARISON (395-28 · CR-04). The scaffold writes files in the call; it never
  # commits. A commit count that moved means something on this road made a Git commit, and nothing
  # the offsets say is worth anything beside that.
  elif [ "$commits_after" != "$commits_before" ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="THE ASK ROAD MADE A GIT COMMIT: commits $commits_before -> $commits_after. The scaffold writes its files in the call and commits nothing, so this is the finding and the offsets (prompt=$prompt_at summary=$summary_at files=$files_at diff=$diff_at) are beside it. Transcript: $transcript"

  # A WEDGED DRIVE IS A FAILED MEASUREMENT, NOT AN ABSENT ONE (395-28 · CR-04).
  elif [ "$timedout" = '1' ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="THE DRIVE WEDGED AND WAS KILLED ON THE DEADLINE — no reading was taken, and that is a FAILED measurement rather than an absent one. Offsets at the kill: prompt=$prompt_at summary=$summary_at files=$files_at diff=$diff_at. Transcript: $transcript"

  # THE D-14 REGRESSION. Before 432 a prompt was the road's subject; now any prompt at all is red,
  # whatever was rendered above it, because nothing on this road may ask.
  elif [ "${prompt_at:--1}" -ge 0 ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="A RETIRED APPROVAL PROMPT RENDERED at byte $prompt_at (D-14): \`agent-qa ask\` asked y/n on a real terminal, which nothing in this product may do. The driver did not answer it. Render offsets: summary=$summary_at files=$files_at diff=$diff_at. Transcript: $transcript"

  elif [ "$rendered" -eq 0 ] && [ "$known_cause" = '1' ]; then
    L6_GRADE_VERDICT='SKIP'
    L6_GRADE_WHY="THE ASK ROAD DID NOT PLAN ON THIS DRIVE, FOR THE KNOWN REASON: \`agent-qa ask\` answered *'No capability in this build handles: …'* — the D-08 headless refusal, which is what \`ask\` says when its composition binds no chat model. Nothing was written and nothing asked. THE RESIDUAL BOUND: $hermetic. Transcript: $transcript"

  # A FAILED COMMAND IS NOT A PLANNER THAT DID NOT ROUTE (WR-13). Only the recognised headless
  # refusal above may exit non-zero with nothing rendered.
  elif [ "$rendered" -eq 0 ] && [ "$status" != '0' ]; then
    L6_GRADE_VERDICT='RED'
    if [ "$status" = '126' ] || [ "$status" = '127' ]; then
      L6_GRADE_WHY="\`agent-qa ask\` COULD NOT BE LAUNCHED (status $status) AND NOTHING RENDERED — a failed command, not a planner that did not route. Transcript: $transcript"
    else
      L6_GRADE_WHY="NOTHING RENDERED AND \`agent-qa ask\` EXITED $status — a failed command, not a planner that did not route. Transcript: $transcript"
    fi

  elif [ "$rendered" -eq 0 ]; then
    L6_GRADE_VERDICT='SKIP'
    L6_GRADE_WHY="NOTHING WAS RENDERED AND NOTHING ASKED ON THIS SINGLE DRIVE: the live planner did not route this utterance to \`write_test\` (its known k=1 nondeterminism, the same one SC-5's own lane lives with), or the turn refused for a reason the branch above does not recognise. THE RESIDUAL BOUND: $hermetic. Live k=1 did not add to it this run. Transcript: $transcript"

  elif [ "$rendered" -lt 3 ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="A PARTIAL RENDER: the change was shown without all of its summary line, config file and unified-diff hunk (summary=$summary_at files=$files_at diff=$diff_at), so a person was not shown what was written. Transcript: $transcript"

  elif [ "$status" != '0' ]; then
    L6_GRADE_VERDICT='RED'
    L6_GRADE_WHY="THE CHANGE WAS RENDERED BUT \`agent-qa ask\` EXITED $status. The summary (byte $summary_at), the config file (byte $files_at) and a diff hunk (byte $diff_at) reached the terminal, and the command still failed. Transcript: $transcript"

  else
    L6_GRADE_VERDICT='PASS'
    L6_GRADE_WHY="THE ASK ROAD COMPLETES IN ONE CALL ON THE SHIPPED VERB (D-14). On a real terminal, over a live planner, nothing asked; the person was shown the change that was written — its summary line (byte $summary_at), the config file it touched (byte $files_at) and a true unified-diff hunk (byte $diff_at); \`ask\` exited 0; and no Git commit appeared: commits $commits_before -> $commits_after."
  fi
}
