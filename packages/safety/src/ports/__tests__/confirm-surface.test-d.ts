// A confirm binding cannot exist without the surface it speaks for (G-401-17).
//
// WHY A `.test-d.ts`. The claim this file makes is that a composition which binds a confirm port
// and declares NOTHING is a COMPILE ERROR rather than a defaulted audit row. No runtime cell can
// state that: a test that constructs a surfaceless binding and observes a row is observing the
// behaviour of code TypeScript would never have let ship. So the assertion is a compile one, and
// `@ts-expect-error` is two-way — it fails `tsc --noEmit` when the binding stops erroring exactly
// as loudly as it fails when it starts.
//
// It lives under `__tests__/` because the arch dependency extractor treats any file outside such a
// directory as production source and would report `vitest` as an unexpected external dep.

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { expectTypeOf } from 'vitest'

import type {
  ConfirmAnsweringSurface,
  ConfirmAsk,
  ConfirmPort,
} from '../policy-ports.js'
import { DENY_CONFIRM } from '../policy-ports.js'

const ask: ConfirmAsk = (_action: RiskActionDescriptor) => true

// ---- 1. THE MUTATION THIS FILE EXISTS FOR ----------------------------------------------------
//
// The fourth confirm port — the one nobody has written yet — binding its channel and saying
// nothing about who answers on it. Under the pre-G-401-17 shape this compiled and silently
// inherited `tty-prompt`; under the paired shape it is `Property 'surface' is missing`.
//
// A DEFAULT, AN OPTIONAL FIELD WITH A FALLBACK, OR A PROPERTY HUNG ON THE FUNCTION OBJECT would
// each make this line compile again, which is why none of them is the mechanism: the omission has
// to be the error, or the enforcement is a list of names somebody has to remember to extend.
// @ts-expect-error a confirm binding must declare the surface it speaks for
const surfaceless: ConfirmPort = { ask }
void surfaceless

// The same omission from the other side: a bare function is what a `ConfirmPort` used to be, and
// it is now exactly as unbindable as an object that forgot the field.
// @ts-expect-error a bare confirm function carries no surface and is no longer a binding
const bareFunction: ConfirmPort = ask
void bareFunction

// A surface this vocabulary does not have is not a way around the check either — the widening is a
// contract change to a published union that lands in durable rows, not a per-composition string.
// @ts-expect-error 'browser-prompt' is not a declared answering surface
const inventedSurface: ConfirmPort = { surface: 'browser-prompt', ask }
void inventedSurface

// ---- 2. What DOES compile -------------------------------------------------------------------

const terminal: ConfirmPort = { surface: 'tty-prompt', ask }
const browser: ConfirmPort = { surface: 'browser-click', ask }
// The honest declaration for a binding that never approves anything.
const refuses: ConfirmPort = { surface: null, ask: () => false }
void terminal
void browser
void refuses

// ---- 3. The vocabulary itself ----------------------------------------------------------------
//
// Stated as an EXACT union rather than as "contains browser-click". A membership check is a list
// somebody has to remember to extend; equality fails on ANY arrival, which is what makes a fifth
// surface a decision somebody takes here rather than one that lands in the audit trail unreviewed.
expectTypeOf<ConfirmAnsweringSurface>().toEqualTypeOf<'tty-prompt' | 'browser-click'>()

// `DENY_CONFIRM` is the ONE surfaceless binding in the workspace, and its type says so.
expectTypeOf<typeof DENY_CONFIRM.surface>().toEqualTypeOf<ConfirmAnsweringSurface | null>()
