import { createAgentQaProgram } from './program.js'
import { rejectRemovedCliSurface } from './removed-cli-surface.js'

rejectRemovedCliSurface()

const program = createAgentQaProgram()

program.parse()

export { program }
