---
name: agent-qa-result-triage
description: Use when investigating failed agent-qa runs, inspecting artifacts, classifying failures, or comparing recent runs. Prefer agent-qa MCP run/artifact tools and produce evidence-backed triage.
metadata:
  short-description: Triage agent-qa run failures
---

# agent-qa Result Triage

## Workflow

1. Start with `agent_qa_get_run_digest` for the run's verdicts, its post-processing chain, the
   outcome of its steps, the proposals awaiting a decision, and the counts. This is the triage read
   over this surface.
2. Fetch the rest of the evidence before deciding:
   - `agent_qa_get_entity` on the run reference, for the run's own card and its suite context.
   - `agent_qa_list_runs`, to see whether related runs failed the same way.
   - Artifacts, logs and the full event feed from the run directory on disk — no tool serves
     artifact bytes, and the digest names what the run produced.
3. Use the digest's verdict as the default classification unless stronger evidence contradicts it.
   It is a reading a job produced, not a verdict handed down.
4. Compare recent related runs when the evidence you have makes the comparison meaningful.
5. Return a concise triage result: category, confidence, evidence, likely fix area, and next action.
6. For code changes, switch to `agent-qa-debug-fix` after triage is complete.

## Categories

Use one of the fixed categories from `references/triage-categories.md`:

- `timeout`
- `appium_startup`
- `browser_disconnect`
- `element_not_found`
- `assertion_failure`
- `hook_failure`
- `infrastructure`
- `unknown_failure`

## Evidence Rules

- Quote or summarize concrete artifact/log/step evidence.
- Mention missing artifact sections if they limit confidence.
- Do not invent screenshots, videos, logs, or memory context that was not returned by MCP.
- If MCP is unavailable, read the local `.agent-qa` run artifacts as a fallback and say which
  evidence was unavailable.
- Do not call a v1 tool name. The migration map carried by `agent-qa init --agent` names every
  retired name and what answers its need instead.
