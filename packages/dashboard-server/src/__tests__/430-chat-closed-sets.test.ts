// THE CONFIRM ROUTER'S AND THE HOST SEAM'S CLOSED SETS (430 D-02).
//
// The type half is pinned in the sibling `.test-d.ts`; this is the runtime half, so a reordered or
// padded list is caught even where the type union still agrees.

import { describe, expect, it } from 'vitest'

import { CHAT_ROUTE_TABLE } from '../chat/chat-routes.js'
import { AGENT_HOST_MEMBERS } from '../chat/host.js'

describe('the confirm router closed sets (430)', () => {
  it('C430-CHAT-ROUTE-TABLE-EXACT: the router serves the run-confirm pair and nothing else', () => {
    expect(CHAT_ROUTE_TABLE.map((row) => [row.method, row.path, row.handler])).toEqual([
      ['POST', '/api/run-confirm/answer', 'runConfirm'],
      ['GET', '/api/run-confirm/channel', 'runConfirmChannel'],
    ])
  })

  it('C430-AGENT-HOST-MEMBERS-EXACT: the host seam carries the run-detail members and the run-confirm pair only', () => {
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
      'enterRunTriggerScope',
      'invokeFunction',
      'confirms',
      'unmaskForDisplay',
    ])
  })
})
