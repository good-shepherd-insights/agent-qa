import { expectTypeOf, it } from 'vitest'
import { JUDGE_ABSTENTION_CAUSES, PANEL_POOLING_MODES } from '../../index'
import type {
  JudgeAbstentionCause,
  JudgeErrorReason,
  JudgeNotInvokedReason,
  JudgeOutcome,
  JudgePairwiseOutcome,
  PanelPoolingMode,
} from '../../index'

// These inventories deliberately do not derive from either production declaration.
type ExpectedPooling = 'max' | 'avg'
type ExpectedAbstention =
  | 'unsure-verdict'
  | 'below-threshold'
  | 'swap-disagreement'
  | 'candidate-overflow'
  | 'missing-evidence'
  | 'residual-tie'
  | 'below-quorum'
  | 'panel-disagreement'

it('panel pooling modes exact type bars', () => {
  expectTypeOf<PanelPoolingMode>().toEqualTypeOf<ExpectedPooling>()
  expectTypeOf<Exclude<ExpectedPooling, PanelPoolingMode>>().toBeNever()
  expectTypeOf<Exclude<PanelPoolingMode, ExpectedPooling>>().toBeNever()
  expectTypeOf<(typeof PANEL_POOLING_MODES)[number]>().toEqualTypeOf<ExpectedPooling>()
  expectTypeOf<Exclude<ExpectedPooling, (typeof PANEL_POOLING_MODES)[number]>>().toBeNever()
  expectTypeOf<Exclude<(typeof PANEL_POOLING_MODES)[number], ExpectedPooling>>().toBeNever()
})

it('panel abstention causes exact type bars', () => {
  expectTypeOf<JudgeAbstentionCause>().toEqualTypeOf<ExpectedAbstention>()
  expectTypeOf<Exclude<ExpectedAbstention, JudgeAbstentionCause>>().toBeNever()
  expectTypeOf<Exclude<JudgeAbstentionCause, ExpectedAbstention>>().toBeNever()
  expectTypeOf<(typeof JUDGE_ABSTENTION_CAUSES)[number]>().toEqualTypeOf<ExpectedAbstention>()
  expectTypeOf<Exclude<ExpectedAbstention, (typeof JUDGE_ABSTENTION_CAUSES)[number]>>().toBeNever()
  expectTypeOf<Exclude<(typeof JUDGE_ABSTENTION_CAUSES)[number], ExpectedAbstention>>().toBeNever()
})

it('panel abstentions preserve transport and not-invoked distinctions', () => {
  expectTypeOf<JudgeErrorReason>().toEqualTypeOf<'provider-error' | 'unparseable-output'>()
  expectTypeOf<JudgeNotInvokedReason>().toEqualTypeOf<'no-judge-configured' | 'no-eligible-judge'>()
  expectTypeOf<Extract<JudgeAbstentionCause, JudgeErrorReason | JudgeNotInvokedReason>>().toBeNever()
  expectTypeOf<JudgePairwiseOutcome['kind']>().toEqualTypeOf<'settled' | 'abstained' | 'error'>()
  expectTypeOf<JudgeOutcome['kind']>().toEqualTypeOf<'abstained' | 'judge-error' | 'not-invoked'>()
  expectTypeOf<Extract<JudgePairwiseOutcome, { kind: 'error' }>['reason']>().toEqualTypeOf<JudgeErrorReason>()
  expectTypeOf<Extract<JudgeOutcome, { kind: 'not-invoked' }>['reason']>().toEqualTypeOf<JudgeNotInvokedReason>()
})
