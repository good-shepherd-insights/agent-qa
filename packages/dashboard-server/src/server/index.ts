export { startServer } from './server.js'
export { createRouter } from './routes.js'
export { readJsonBody } from './body-parser.js'

// The fourth door (400-01). The router and the injected-host seam are published because the CLI
// command that starts this server composes the host, and the conformance suite drives the router.
export {
  CHAT_CAPABILITIES_ROUTE,
  CHAT_CONFIRM_ROUTE,
  CHAT_ROUTE_PREFIX,
  CHAT_STREAM_BOUNDS,
  CHAT_TURN_ROUTE,
  createChatRouter,
  recordStreamedEvent,
} from '../chat/chat-routes.js'
// The confirm bridge (400-03). The registry is created by the command that composes the door — the
// composition parks questions in it and the routes serve them — so both its factory and its
// vocabulary are published.
export {
  CHAT_CONFIRM_ANSWERS,
  CHAT_CONFIRM_TIMEOUT_MS,
  createConfirmRegistry,
} from '../chat/confirm-registry.js'
export type {
  ChatConfirmAnswer,
  ChatConfirmAnswerOutcome,
  ChatConfirmChannelFrame,
  ChatConfirmRequest,
  ConfirmRegistry,
  CreateConfirmRegistryOptions,
} from '../chat/confirm-registry.js'
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
