// `config.get` — the masked resolved-configuration read (Phase 384, D-06).
//
// The op is a pass-through by design. Masking happens where the configuration is RESOLVED,
// inside the composition root, while each entry is constructed. If this op masked instead,
// an unmasked config would exist inside the layer and the security property would depend on
// this function never being bypassed — exactly the guarantee the layer refuses to rest on.

import { ConfigGetInputSchema, MaskedResolvedConfigSchema } from '@vostride/agent-qa-schema'
import type { ConfigGetInput, MaskedResolvedConfig } from '@vostride/agent-qa-schema'

import type { FunctionSpec } from '../spec.js'

export const CONFIG_GET_FUNCTION_ID = 'config.get'

export const configGetSpec: FunctionSpec<ConfigGetInput, MaskedResolvedConfig> = {
  id: CONFIG_GET_FUNCTION_ID,
  summary: 'Read the resolved project configuration with secret-bearing values masked.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  bindingStatus: 'bound',
  input: ConfigGetInputSchema,
  output: MaskedResolvedConfigSchema,
  risk: { name: `fn:${CONFIG_GET_FUNCTION_ID}`, recognized: true, readOnly: true },
  invoke(_input, deps) {
    return deps.config.getMasked()
  },
}
