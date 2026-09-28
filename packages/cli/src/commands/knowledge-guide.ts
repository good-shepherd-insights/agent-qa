export const KNOWLEDGE_SKILL_NAME = 'agent-qa-knowledge'

export const WRITE_AGENT_INSTRUCTIONS_FLAG = '--write-agent-instructions'

export interface AgentQuestion {
  readonly question: string
  readonly cli: string
  readonly mcp: string
}

export const AGENT_QUESTION_MAP: readonly AgentQuestion[] = Object.freeze([])

export function buildKnowledgeAgentGuide(): string {
  return ''
}

export function buildAgentInstructionPointer(): readonly string[] {
  return []
}
