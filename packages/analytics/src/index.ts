// The `@vostride/agent-qa-analytics` public surface (Phase 398 plan 03, D-17 · ANLY-01).
//
// WHAT IS DELIBERATELY ABSENT. There is no `getAnalytics()`, no `captureAnalytics()`, no
// `flushAnalytics()` — no way to reach telemetry without having been handed a port. The v1 module
// published exactly those three, and the consequence was that any file in the process could emit,
// carrying whatever privacy decision the first constructor happened to make. A host that wants to
// emit here has to name this package at its composition root and hold the object.
//
// The ownership contract is NOT re-exported: `pnpm validate:publish` refuses a dist that ships it,
// and `packages/arch` imports it by relative path, which is the sanctioned route.

export { createAnalyticsPort, ANONYMOUS_ANALYTICS_IDENTITY, resolveAnonymousIdentity } from './port.js'
export type {
  AnalyticsCapturePayload,
  AnalyticsEventEnvelope,
  AnalyticsIdentity,
  AnalyticsIdentityResolver,
  AnalyticsPort,
  AnalyticsPortOptions,
  AnalyticsPropertyValue,
  AnalyticsTransport,
} from './port.js'

export { createPosthogTransport, NoopTransport } from './transports.js'
export type {
  PosthogAnalyticsClient,
  PosthogTransportFactory,
  PosthogTransportOptions,
} from './transports.js'
