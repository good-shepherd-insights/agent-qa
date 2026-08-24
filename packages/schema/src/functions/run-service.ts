// The remote run service's wire vocabulary (Phase 402 plan 01, D-06 / D-13 / D-15 · INVK-03).
//
// WHAT LIVES HERE AND WHAT DELIBERATELY DOES NOT. This file holds the vocabulary the authed run
// service speaks on the wire: the header verdict, the closed error-code set every refusal answers
// with, the readiness DTO, the request shape, and the door's own contract version. It holds no
// transport, no token, no route and no handler — the router that serves these words lives in
// `packages/dashboard-server` and the composition that mints them lives in the CLI, because a
// mountable module (D-02) can only be mountable if its vocabulary is reachable from a package
// neither of them owns.
//
// THE EVENT VOCABULARY IS NOT HERE EITHER, AND THAT ABSENCE IS THE POINT (D-13). The stream serves
// the frozen bus envelope verbatim — `RunEventEnvelopeSchema`, SSE `id` = `seq`, `event` = `type`.
// A projection DTO in this file would be a second event vocabulary to drift against the first.

import { z } from 'zod'

import type { TrustScope } from '../safety/trust-credential'

/**
 * The door's own contract version, bumped INDEPENDENTLY of the bus envelope's.
 *
 * Two versions because two contracts move for different reasons: `RUN_EVENT_ENVELOPE_SCHEMA_VERSION`
 * describes the frozen event frame, and this describes what routes exist and what they answer. 403
 * adds the attach contract to this door and will bump THIS constant without touching an envelope.
 */
export const RUN_SERVICE_CONTRACT_VERSION = 1

/**
 * Why a request was refused at the door — the closed set, spelled once (388 C13).
 *
 * THREE REASONS AND NO FOURTH, and the fourth that is missing is the one that matters: there is no
 * `default_grant`, no `unauthenticated` and no permissive arm anywhere in this vocabulary. D-06
 * deletes the MCP door's no-credential-presented arm for this surface; a caller that presents
 * nothing is refused with `missing_authorization`, which is a REFUSAL and not a weaker success.
 */
export const SERVICE_BEARER_REFUSAL_REASONS = [
  'missing_authorization',
  'malformed_authorization',
  'invalid_token',
] as const

export type ServiceBearerRefusalReason = (typeof SERVICE_BEARER_REFUSAL_REASONS)[number]

/**
 * The verdict on one request's `Authorization` header — TWO arms, and the count is the contract.
 *
 * The MCP door's verdict has three because a local caller that presents nothing gets a default
 * grant. This door has two because it does not, and a shape with only two arms is what makes that
 * unrepresentable rather than merely undone: there is no value of this type that means "nobody
 * presented anything, serve them anyway", so no careless `??` can produce one.
 */
export type ServiceBearerVerdict =
  | { readonly kind: 'token'; readonly clientId: string; readonly trustScope: TrustScope }
  | { readonly kind: 'refused'; readonly reason: ServiceBearerRefusalReason }

/**
 * Every code any non-2xx answer on this door carries. Closed, and shared across all routes.
 *
 * The three refusal reasons are members so that an unauthorized answer and every other error
 * answer have ONE body shape — see {@link RunServiceErrorBodySchema}.
 */
export const RUN_SERVICE_ERROR_CODES = [
  ...SERVICE_BEARER_REFUSAL_REASONS,
  'refused_request_field',
  'invalid_request_body',
  'unknown_run',
  'unknown_route',
  'run_start_failed',
  'replay_unavailable',
  // 402-04 (D-14, T-402-14): the `?handle=` parameter's two refusals, kept APART. `invalid_handle`
  // says the parameter was not a canonical non-negative integer — a fact about the caller's own
  // input, which it already has. `unknown_handle` says the parse succeeded and no member of this
  // run answers to it. Both are answered before any stream header, and neither echoes the value.
  'invalid_handle',
  'unknown_handle',
] as const

export type RunServiceErrorCode = (typeof RUN_SERVICE_ERROR_CODES)[number]

/**
 * The ONE error body this door writes — a single key carrying a closed code.
 *
 * ONE KEY, DELIBERATELY. A refusal body that varied its SHAPE by route or by reason would be a
 * fingerprinting surface: a caller with no credential could learn which routes exist, whether a
 * run id is real, or whether any token is declared at all, by diffing the bodies it is refused
 * with. With one key and a closed vocabulary the only thing that varies is the word, and the words
 * that can appear before a verdict is settled are the three refusal reasons and nothing else.
 *
 * It is also why nothing here echoes the caller's input. Naming the offending field, the run id or
 * the entry that nearly matched would each put an attacker-chosen or a host-held string into a
 * body served to an unauthenticated caller.
 */
export const RunServiceErrorBodySchema = z.object({
  error: z.enum(RUN_SERVICE_ERROR_CODES),
}).strict()

export type RunServiceErrorBody = z.infer<typeof RunServiceErrorBodySchema>

/**
 * The request fields this door REFUSES outright (D-07 / D-12, 401's law carried to the wire).
 *
 * A token-holder may not name the terms of its own authorization, may not choose the identity its
 * run is addressed by, and may not turn up concurrency on a target whose config owner tuned it.
 * The core's own `REFUSED_RUN_REQUEST_FIELDS` refuses `scope` and `executionContext` a layer down;
 * `runId` joins them HERE because the local dashboard door legitimately supplies one (its queue
 * minted the row) and the remote door legitimately does not — the difference is a property of the
 * door, so it is stated at the door.
 */
export const RUN_SERVICE_REFUSED_REQUEST_FIELDS = ['runId', 'scope', 'executionContext'] as const

/**
 * What a remote caller may say when starting a run: the pattern set, and nothing else.
 *
 * `.strict()`, so an unrecognised key is a typed refusal rather than a silently ignored request —
 * the same law `RunsStartInputSchema` is under. Absent `patterns` means "the configured default
 * set", which is what an argument-less `runs.start` already means.
 */
export const RunServiceStartRequestSchema = z.object({
  patterns: z.array(z.string()).optional(),
}).strict()

export type RunServiceStartRequest = z.infer<typeof RunServiceStartRequestSchema>

/**
 * What `/ok` reports (D-15): measured facts, and no prediction.
 *
 * SHALLOW BUT HONEST. Each field is something this process can observe about ITSELF right now —
 * the service answered, a host is composed, at least one credential resolved, and which contract
 * version these routes implement. There is no `ready: true`, because a run's success depends on a
 * browser, a model, a network and a target, none of which this route touched. Deep diagnostics
 * (knowledge rungs, embedder health) belong to 407's `doctor` and are deliberately absent.
 *
 * `hostComposed` is measured off the SAME state the invoke path's guard throws on, so a `/ok` that
 * says the host is composed and a `POST /run` that says it is not cannot disagree.
 */
export const RunServiceReadinessSchema = z.object({
  service: z.literal('up'),
  hostComposed: z.boolean(),
  authConfigured: z.boolean(),
  contractVersion: z.number().int().positive(),
}).strict()

export type RunServiceReadiness = z.infer<typeof RunServiceReadinessSchema>
