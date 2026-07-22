import { Command } from 'commander'

import { registerKnowledgeReadCommands } from './knowledge-read.js'

export function createKnowledgeCommand(): Command {
  const command = new Command('knowledge')
    .description('Inspect and maintain the knowledge store')

  registerKnowledgeReadCommands(command)

  return command
}
