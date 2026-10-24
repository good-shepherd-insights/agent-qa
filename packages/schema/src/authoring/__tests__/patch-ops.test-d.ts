// Type-level pins on the edit vocabulary (394, D-20).
//
// The closed three-member op set is what makes the CST applier's `switch` exhaustive. A fourth
// member added to `PATCH_OP_KINDS` would compile fine on its own; these assertions are what make
// it fail HERE, next to the reason, rather than at whichever call site guesses wrong first.

import { expectTypeOf } from 'vitest'

import type {
  EditablePointerRoot,
  PatchOp,
  PatchOpKind,
  TestEditPatchSet,
} from '../patch-ops'

expectTypeOf<PatchOpKind>().toEqualTypeOf<'add' | 'remove' | 'replace'>()
expectTypeOf<PatchOp['op']>().toEqualTypeOf<'add' | 'remove' | 'replace'>()

expectTypeOf<EditablePointerRoot>().toEqualTypeOf<'steps' | 'name' | 'context'>()

// `remove` carries no `value`: narrowing on the discriminant must remove the field entirely,
// not widen it to `string | undefined`, or the applier could write a value on a removal.
type RemoveOp = Extract<PatchOp, { op: 'remove' }>
expectTypeOf<RemoveOp>().toEqualTypeOf<{ op: 'remove'; path: string }>()

type AddOp = Extract<PatchOp, { op: 'add' }>
expectTypeOf<AddOp>().toEqualTypeOf<{ op: 'add'; path: string; value: string }>()

expectTypeOf<TestEditPatchSet>().toEqualTypeOf<{ thoughts: string; patches: PatchOp[] }>()
