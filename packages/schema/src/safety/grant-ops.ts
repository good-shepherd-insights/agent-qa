// The trust-scope wire projection (Phase 391, D-03; narrowed 2026-10-01 by 432-18).
//
// This module held the standing-grant verbs' wire contract and the port they dispatched through.
// 432-18 (D-14/D-15) deletes the grant ledger, `grants.list`, `grants.revoke` and the port, so every
// grant op DTO left with them. What remains is the strict `TrustScopeSchema` projection, kept until
// its last consumer leaves: `config/run-service.ts` parses a declared run-service credential's trust
// scope through it, and 432-22 removes that DTO together with this projection.

import { z } from 'zod'

import { TRUST_SCOPE_KEYS } from './trust-credential'
import type { TrustScope, TrustScopeKey } from './trust-credential'

/** True only when the two types are mutually assignable — a real equality, not a subtype check. */
type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * The WIRE projection of {@link TrustScope}.
 *
 * `trust-credential.ts` declares the scope as a browser-safe DTO interface and deliberately not as
 * a schema; the function layer requires a live validator plus an inert JSON-Schema projection for
 * every declared contract (384 D-14), so the projection is minted here, at the boundary that needs
 * one, and never in the module that owns the type.
 *
 * Every member is `.min(1)` even though the DTO says only `string`: an empty-string member is a key
 * that reads as present and carries nothing.
 *
 * THE KEY SET IS NOT SPELLED HERE (391-11, closing G-391-1). The shape is BUILT from
 * {@link TRUST_SCOPE_KEYS}. This file previously restated `{project, org}` as its own literal, and
 * the assertion below was the only thing meant to tie them.
 *
 * WHY THAT ASSERTION WAS NOT ENOUGH, and why the two `keyof` pins now sit beside it: mutual
 * assignability over an all-optional object type is satisfied by a SUPERSET and a SUBSET alike, so
 * adding an optional key to one side breaks neither direction and `ExactlyEqual` holds vacuously.
 * TypeScript's excess-property check would catch it only on a fresh object literal, and this repo
 * does not enable `exactOptionalPropertyTypes`. `keyof` produces a string-literal union instead, and
 * `ExactlyEqual` over unions IS exact — which is precisely why the key-union assertion at
 * `trust-credential.ts:32` holds while the shape-only one did not.
 */
export const TrustScopeSchema = z.object(
  Object.fromEntries(
    TRUST_SCOPE_KEYS.map((key) => [key, z.string().min(1).optional()]),
  ) as Record<TrustScopeKey, z.ZodOptional<z.ZodString>>,
).strict()

/** The member VALUE type and its optionality — this pin survives, it was never the weak one. */
const _trustScopeProjectionMatchesDto: ExactlyEqual<z.infer<typeof TrustScopeSchema>, TrustScope> =
  true
void _trustScopeProjectionMatchesDto

/** KEY-SET EXACT, in both directions a single leg can move. */
const _trustScopeProjectionKeysMatchTheConstant: ExactlyEqual<
  keyof z.infer<typeof TrustScopeSchema>,
  TrustScopeKey
> = true
void _trustScopeProjectionKeysMatchTheConstant

const _trustScopeProjectionKeysMatchTheDto: ExactlyEqual<
  keyof z.infer<typeof TrustScopeSchema>,
  keyof TrustScope
> = true
void _trustScopeProjectionKeysMatchTheDto
