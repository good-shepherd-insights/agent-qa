import type { MaskFn } from '@vostride/agent-qa-schema'

import type { FunctionDeps } from '../spec.js'

// 2026-10-14 (441-16, D-06, E3): a refusing run read masks with the host's declared mask. Unbound,
// it refuses here; a mask that throws (the secrets file cannot be read) refuses with its own message,
// probed once so the refusal does not depend on what the run happens to hold.
export function requireSecretMask(deps: FunctionDeps, functionId: string): MaskFn {
  const mask = deps.secretMask
  if (mask === undefined) {
    throw new Error(`${functionId} cannot mask run text: this host binds no declared-secret mask.`)
  }
  mask('')
  return mask
}
