// THE HOST SEAM'S CLOSED SET, AND THE RETIRED CONFIRM ROUTER'S ABSENCE (430 D-02; 432-14 D-14).
//
// The type half is pinned in the sibling `.test-d.ts`; this is the runtime half, so a reordered or
// padded list is caught even where the type union still agrees.

import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AGENT_HOST_MEMBERS } from '../chat/host.js'

// 2026-10-02 (432-44): the directory is named as a literal under a URL root, the shape the mutation
// engine's arrival proof follows, so a route-table module CREATED beside the host seam (430 leg R06)
// provably reaches this cell. Same directory, same claim.
const SERVER_SRC = new URL('../', import.meta.url)
const CHAT_DIR = fileURLToPath(new URL('chat/', SERVER_SRC))

describe('the confirm router closed sets (430)', () => {
  // RE-SPELLED 2026-10-01 (432-14, D-14): was 'the router serves the run-confirm pair and nothing
  // else'. The pair and its router are deleted, so the table has no rows left to pin; the claim that
  // survives is that the server's conversation-era directory now holds the host seam and nothing
  // that could dispatch or park a question.
  it('C430-CHAT-ROUTE-TABLE-EXACT: no route table or confirm registry module remains beside the host seam', () => {
    const modules = readdirSync(CHAT_DIR).filter((name) => /\.tsx?$/.test(name)).sort()
    expect(modules).toEqual(['host.ts'])
    for (const retired of ['chat-' + 'routes.ts', 'confirm-' + 'registry.ts']) {
      expect(existsSync(new URL(`../chat/${retired}`, import.meta.url)), retired).toBe(false)
    }
  })

  it('C430-AGENT-HOST-MEMBERS-EXACT: the host seam carries the run-detail and mark members only', () => {
    expect(AGENT_HOST_MEMBERS).toEqual([
      'registry',
      'caller',
      'runsPostProcessingFunctionId',
      'runsEventsFunctionId',
      'runsDetailFunctionId',
      'runsEvidenceFunctionId',
      'runsArtifactFunctionId',
      'analysisGetFunctionId',
      'runsKnowledgeFunctionId',
      'runsMarkFunctionId',
      'runsMarksHistoryFunctionId',
      'runsMarkPreviewFunctionId',
      'invokeFunction',
      'unmaskForDisplay',
    ])
  })
})
