---
name: agent-qa-debug-fix
description: Use after an agent-qa run has failed and you need to debug, patch, and verify the issue using MCP evidence, logs, artifacts, and local code changes instead of generated fix suggestions.
metadata:
  short-description: Debug and fix failed agent-qa runs
---

# agent-qa Debug Fix

## Workflow

1. Start with evidence collection:
   - `agent_qa_get_run_digest` — the run's verdicts, its post-processing chain, the outcome of its
     steps, and what it produced. This is the triage read over this surface.
   - `agent_qa_get_entity` on the run reference — the run's own card.
   - `agent_qa_list_runs` — recent runs, when the question is whether this failure is new.
   - Artifacts and the full event feed are read from the run directory on disk. No tool serves
     artifact bytes; the digest names what a run produced so you know which file to open.
2. Treat the digest's verdict as a hypothesis, not a conclusion — it is the reading a job produced,
   and the evidence it points at is what settles the question.
3. Identify the failing surface: test definition, hook, application under test, runtime
   infrastructure, or agent behavior.
4. Inspect the relevant local files directly. Do not infer patches from artifacts alone.
5. Apply the smallest code or YAML change that explains the evidence.
6. Re-run the narrowest affected agent-qa test, suite, hook, or unit test — `agent_qa_start_run`
   takes the scope as an argument.
7. Report the root cause, changed files, verification command, and any remaining risk.

## Fix Rules

- Do not invent selectors, screen states, screenshots, logs, or source files.
- Do not rewrite a test just to make it pass if the artifact shows a product or runtime defect.
- Preserve canonical agent-qa IDs when editing tests, suites, hooks, or memory files.
- Verify edited YAML with `agent_qa_refine_test`'s verify arm before re-running. It returns the same
  verdict that gates the write, and it is the only validator.
- When MCP is unavailable, read the local `.agent-qa` run artifacts and say that MCP evidence was
  unavailable.
- Do not call a v1 tool name. The migration map carried by `agent-qa init --agent` names every
  retired name and what answers its need instead.
