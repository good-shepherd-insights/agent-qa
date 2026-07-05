import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'

// EXECUTION shapes (adapter-facing). Defaults are modeled as required here because these
// types represent post-parse output. Critically, `ref` is REQUIRED on these shapes:
// adapters receive fully-grounded actions (D-08). The EMISSION projections at the bottom of
// this file widen `ref` to optional and add a `target` descriptor sibling — that is what the
// planner may SAY. The Plan-04 grounding gate is the converting boundary between the two
// worlds; adapter contracts must never be loosened to the emission shape (Pitfall 2).
export type Fill = {
  ref: Ref
  text: string
  clearMode: 'replace' | 'append'
  submit: boolean
}

export type Scroll =
  | {
      mode: 'direction'
      direction: 'up' | 'down' | 'left' | 'right'
      ref?: Ref
      amount: 'page' | 'halfPage' | 'toEnd'
      retryOpposite: boolean
    }
  | {
      mode: 'untilVisible'
      text: string
      ref?: Ref
      direction: 'up' | 'down' | 'left' | 'right'
      maxSwipes: number
      retryOpposite: boolean
    }

export type WaitFor =
  | { on: 'text'; text: string; timeoutMs: number }
  | { on: 'selector'; selector: string; timeoutMs: number }
  | { on: 'gone'; text: string; timeoutMs: number }

type SwipeBase = {
  type: 'swipe'
  durationMs: number
}

export type SwipeByDirection = SwipeBase & {
  mode: 'direction'
  direction: 'up' | 'down' | 'left' | 'right'
  ref?: Ref
}

export type SwipeByPath = SwipeBase & {
  mode: 'path'
  from: Point
  to: Point
  coordSpace: 'viewport' | 'screen'
}

// --- EMISSION projection (planner-facing) -----------------------------------------------
// What the planner MAY emit for a ref-bearing tool: `ref` becomes optional and an
// exactly-one-of `target` descriptor sibling appears. These are NOT the shapes adapters
// receive — the grounding gate (Plan 04) resolves `target` → `ref` before execution.
//
// `EmittedTargetDescriptor` mirrors the tool surface's `targetSchema` (the runner
// `targetSchema` zod const): matcher-required `name`, `near` omitted from the M1 surface
// (D-06), no selector-like field. It is the tool-surface projection of the schema
// `TargetDescriptor` vocabulary; params-drift pins `z.infer<typeof targetSchema>` against it
// so the two never drift.
export type EmittedTargetDescriptor = {
  role?: string
  name: string
  ordinal?: number
}

// Flattens an intersection into a single object literal (preserving `?`/`readonly` via a
// homomorphic mapped type) so the emission projections compare equal to zod's flat inference.
type Simplify<T> = { [K in keyof T]: T[K] }

// Widen a ref-bearing execution branch to its emitted form: a branch with a REQUIRED `ref`
// gets `ref` optional plus an optional `target`; branches without a required `ref` pass
// through unchanged (their optional container-`ref` is handled by `WithEmittedTarget`).
export type WithEmittedRef<T> = T extends { ref: Ref }
  ? Simplify<Omit<T, 'ref'> & { ref?: Ref, target?: EmittedTargetDescriptor }>
  : T

// Add the optional `target` descriptor to every branch of a shape whose `ref` is already
// optional (container refs: scroll/swipe).
export type WithEmittedTarget<T> = T extends unknown
  ? Simplify<T & { target?: EmittedTargetDescriptor }>
  : never

export type PlannedFill = WithEmittedRef<Fill>
export type PlannedScroll = WithEmittedTarget<Scroll>
