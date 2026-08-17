---
name: agent-qa-authoring
description: Use when creating, editing, validating, or running agent-qa tests, suites, or hooks. Prefer agent-qa MCP tools, enforce canonical agent-qa IDs, and use the bundled schema reference to avoid hallucinated config keys or YAML fields.
metadata:
  short-description: Author agent-qa tests safely
---

# agent-qa Authoring

## Workflow

1. Discover the surface from the protocol itself: `tools/list` names every tool your grants let you
   see. For the full picture — the capability catalog, the v1 to v2 tool-name migration map, and
   this workspace's posture — run `agent-qa init --agent`, which prints one JSON document and
   writes nothing.
2. Read the workspace posture from that same manifest: default scopes, safe-mode state, and
   declared credentials by environment-variable NAME. No MCP tool reads configuration.
3. Load `references/agent-qa-contracts.json` when you need exact schema fields or ID contracts.
4. Never mint an ID and never hand-write one. IDs are minted host-side where the entity is written:
   name what you want, then read the id back off the entity card `agent_qa_get_entity` returns.
5. Never validate an ID by hand either. The one URI codec validates every `agentqa://` reference as
   it is parsed, including the one `agent_qa_get_entity` resolves — a reference that comes back
   resolved is a reference that was well-formed.
6. Validate before you write. `agent_qa_refine_test`'s verify arm returns the same verdict that
   gates the write; there is no standalone linter over pasted text, on purpose, because a second
   validator can disagree with the one that gates.
7. Authoring mutations go through the proposal funnel, never a blind write:
   - A new test or suite file: `agent_qa_write_test`, which names the suite file the draft joins and
     files a reviewable proposal instead of writing.
   - An edit to a draft: `agent_qa_refine_test`.
   - A new hook: `agent_qa_propose_config_change`, so the hook arrives as a reviewable diff.
   - Applying what was filed: `agent_qa_apply_proposal`, or `agent_qa_apply_config_proposal` for a
     configuration change. `agent_qa_list_proposals` and `agent_qa_show_proposal` read the inbox.
8. There is no delete verb on any surface, by rule rather than by omission. Removing a test, a suite
   or a hook is a repository edit a person makes and reviews.
9. Editing an existing hook has no tool yet: it is an edit to `workspace.hooksFile` in the workspace
   until the owning milestone rules on the verb.
10. Keep file paths matched by `workspace.testMatch` or `workspace.suiteMatch`.

## Required ID Contracts

- Test IDs: `t_` + 10 id-agent words.
- Suite IDs: `s_` + 10 id-agent words.
- Hook IDs: `h_` + 10 id-agent words.
- Run IDs: `r_` + 10 id-agent words.
- Observation IDs: `obs_` + 10 id-agent words.

## Before Running

- Verify the draft first (step 6).
- Start runs with `agent_qa_start_run` rather than shelling out. The test-or-suite scope is an
  argument to it, not a second tool.
- `agent_qa_list_runs` enumerates recent runs; `agent_qa_get_run_digest` reports one.

## Do Not

- Do not invent config keys.
- Do not use legacy root config buckets.
- Do not hand-write IDs.
- Do not mutate files outside the configured workspace patterns.
- Do not call a v1 tool name. Every retired name and what answers its need instead is carried by the
  migration map in `agent-qa init --agent`; calling one returns that ruling rather than a result.
