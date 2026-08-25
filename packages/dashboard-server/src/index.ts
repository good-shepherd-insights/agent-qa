export * from './db/index.js'
export * from './reporter/index.js'
export * from './server/index.js'
export * from './config/index.js'
export {
  InProcessExecutionBackend,
  createInProcessExecutionBackend,
  type InProcessExecutionBackendOptions,
  type InProcessRunStarter,
  type InProcessRunStartInput,
  type InProcessRunStatus,
} from './execution/in-process-backend.js'
export type {
  ExecuteOptions,
  ExecutionBackend,
  LiveExecutionEvent,
  RunSettledDetails,
  RunSettledStatus,
} from './execution/execution-backend.js'
export { AppiumManager } from './execution/appium-manager.js'
export { TestFileManager } from './tests/test-file-manager.js'
export type { TestFileInfo, TestValidationResult, TestValidationError } from './tests/test-file-manager.js'
// 402-01 (D-02/D-06/D-13 · INVK-03): the authed run service — a mountable module whose every
// reach into the world arrives as injected ports. The CLI's `dashboard` command composes the
// ports and hands them to `startServer`; the route table is published so a census cell can
// enumerate every path this door answers.
export {
  RUN_SERVICE_EVENTS_TEMPLATE,
  RUN_SERVICE_LIVE_URL_TEMPLATE,
  RUN_SERVICE_OK_ROUTE,
  RUN_SERVICE_ROUTE_TABLE,
  RUN_SERVICE_START_ROUTE,
  createRunServiceRoutes,
  matchRunServiceRoute,
  ownsRunServicePath,
  // 402-06 (T-402-22): the structural denial read the 403 body is built from.
  runDenialOf,
} from './run-service/run-service-routes.js'
// 403 D-06: the live-view surface — the served page, the frame proxy, and the wire vocabulary
// both ends type against. Published because the CLI composes the proxy's deps and the conformance
// cells drive the page.
export {
  LIVE_EMBED_EXPIRED_MESSAGE,
  LIVE_EMBED_STATES,
  renderLiveEmbedPage,
} from './live-view/embed-page.js'
export { createFrameProxy } from './live-view/frame-proxy.js'
export {
  LIVE_EMBED_PATH_PREFIX,
  LIVE_VIEW_HELLO_MAX_BYTES,
  LIVE_VIEW_PING_MS,
  LIVE_VIEW_REFUSAL_CLOSE_CODE,
  LIVE_VIEW_REFUSAL_REASONS,
  LIVE_VIEW_SLOW_VIEWER_BYTES,
  LIVE_VIEW_WS_PATH,
} from './live-view/protocol.js'
export type {
  LiveViewClientMessage,
  LiveViewRefusalReason,
  LiveViewServerMessage,
} from './live-view/protocol.js'
export type { LiveEmbedState } from './live-view/embed-page.js'
export type {
  MintLiveUrlInput,
  ResumePoint,
  RunServicePorts,
  RunServiceRouteHandlerName,
  RunServiceRouteMatch,
  RunServiceRouteRow,
  RunServiceRouter,
  RunServiceStartInput,
} from './run-service/run-service-routes.js'
