import type { Action, ActionResult } from '@vostride/agent-qa-schema'

export interface ToolsPort {
  execute(action: Action): Promise<ActionResult>
}
