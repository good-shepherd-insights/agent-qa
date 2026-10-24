import { actionWireSchema as canonical, ACTION_WIRE_SCHEMAS_BY_TYPE as canonicalMap } from '@vostride/agent-qa-schema'
import { actionWireSchema, ACTION_WIRE_SCHEMAS_BY_TYPE } from '../action-wire-schema'
import { expect, it } from 'vitest'

it('preserves the eval import path as the same schema-owned validators', () => {
  expect(actionWireSchema).toBe(canonical)
  expect(ACTION_WIRE_SCHEMAS_BY_TYPE).toBe(canonicalMap)
})
