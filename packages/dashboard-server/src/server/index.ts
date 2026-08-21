export { startServer } from './server.js'
export { createRouter } from './routes.js'
export { readJsonBody } from './body-parser.js'

// The fourth door (400-01). The router and the injected-host seam are published because the CLI
// command that starts this server composes the host, and the conformance suite drives the router.
export {
  CHAT_CAPABILITIES_ROUTE,
  CHAT_ROUTE_PREFIX,
  CHAT_STREAM_BOUNDS,
  CHAT_TURN_ROUTE,
  createChatRouter,
  recordStreamedEvent,
} from '../chat/chat-routes.js'
export type {
  ChatRouter,
  SessionStreamWindow,
} from '../chat/chat-routes.js'
export type {
  AgentDeclarationRow,
  AgentHost,
  AgentRegistryHandle,
  AgentResultFold,
  ChatTurnFold,
  ChatTurnResponse,
} from '../chat/host.js'
