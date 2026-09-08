import { registerHooks } from 'node:module'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

// Run the actual host source with Node24, resolving its emitted .js names to local .ts.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context) }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || !specifier.endsWith('.js')) throw error
    return nextResolve(specifier.slice(0, -3) + '.ts', context)
  }
} })
const input = JSON.parse(process.argv[2])
const { createFeedbackPortForHost } = await import('../../feedback-host.ts')
await createFeedbackPortForHost({ configPath: input.configPath, agentQaRoot: input.agentQaRoot,
  randomUuid: randomUUID, word: async () => {
    writeFileSync(input.ready, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
    return await new Promise(() => { setInterval(() => {}, 1000) })
  } }).mark({ runId: input.runId, kind: 'false-fail' })
