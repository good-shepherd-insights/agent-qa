export { startServer } from './server.js'
export { createRouter } from './routes.js'
export { readJsonBody } from './body-parser.js'

// The fourth door (400-01). The router and the injected-host seam are published because the CLI
// command that starts this server composes the host, and the conformance suite drives the router.
// 400-14: the route TABLE, the safe-method set and the matcher are published beside them, because
// gap 6's guards are applied to the method above the table rather than to each arm — and the only
// way a cell can prove that ranges the COMPLETE set of mutating routes is to enumerate the table
// dispatch itself reads.
export {
  CHAT_CAPABILITIES_ROUTE,
  CHAT_CATALOG_ROUTE,
  CHAT_CONFIRM_ROUTE,
  CHAT_ROUTE_PREFIX,
  CHAT_ROUTE_TABLE,
  CHAT_SAFE_METHODS,
  CHAT_SESSION_EVENTS_TEMPLATE,
  CHAT_STREAM_BOUNDS,
  CHAT_TURN_ROUTE,
  createChatRouter,
  isMutatingChatRequest,
  matchChatRoute,
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
  ChatRouteHandlerName,
  ChatRouteMatch,
  ChatRouteRow,
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
