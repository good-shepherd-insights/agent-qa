export { startServer } from './server.js'
export { createRouter } from './routes.js'
export { readJsonBody } from './body-parser.js'
// 400-16 (gap 7): the ONE guarded request-URL parse, published so a cell can drive the producer
// itself rather than a re-implementation of it, and so a future frame that needs to parse a request
// URL has somewhere to import the only parse there is.
export {
  backstopServerError,
  refuseUnparseableRequest,
  tryParseRequestUrl,
} from './request-url.js'

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
  RUN_CONFIRM_ANSWER_ROUTE,
  RUN_CONFIRM_CHANNEL_ROUTE,
  RUN_CONFIRM_ROUTE_PREFIX,
  RUN_CONFIRM_SCOPE_FRAME_KIND,
} from '../chat/chat-routes.js'
// The confirm bridge (400-03). The registry is created by the command that composes the door — the
// composition parks questions in it and the routes serve them — so both its factory and its
// vocabulary are published.
export {
  CHAT_CONFIRM_ANSWERS,
  CHAT_CONFIRM_TIMEOUT_MS,
  createConfirmRegistry,
  isRunTriggerConfirmScope,
  mintRunTriggerConfirmScope,
  RUN_TRIGGER_CONFIRM_SCOPE_PREFIX,
} from '../chat/confirm-registry.js'
export type {
  ChatConfirmAnswer,
  ChatConfirmAnswerOutcome,
  ChatConfirmChannelFrame,
  ChatConfirmRequest,
  ConfirmRegistry,
  ConfirmScopeId,
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
