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
  RUN_SERVICE_ROUTE_TABLE,
  RUN_SERVICE_START_ROUTE,
  createRunServiceRoutes,
  matchRunServiceRoute,
  ownsRunServicePath,
} from './run-service/run-service-routes.js'
export type {
  RunServicePorts,
  RunServiceRouteHandlerName,
  RunServiceRouteMatch,
  RunServiceRouteRow,
  RunServiceRouter,
  RunServiceStartInput,
} from './run-service/run-service-routes.js'
