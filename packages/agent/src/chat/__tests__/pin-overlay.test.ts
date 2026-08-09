// The session pin holder's contract (Phase 392, D-21, plan 05).
//
// THE CORPUS IS THE REAL REGISTRY, not a hand-built list of declarations. That choice is the
// point of the file rather than a detail of it: the claim under test is "a pin is validated
// against the action classes this host actually has", and a fixture that spelled its own
// declarations would validate the pin against the test's opinion of the catalogue. The one defect
// this module exists to prevent — a pin accepted against a name nothing answers to — is invisible
// to a corpus that invented the names.

import { describe, expect, it } from 'vitest'

import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  PROTECTED_ACTION_CLASSES,
} from '@vostride/agent-qa-schema'
import type { FunctionCaller, RiskActionDescriptor } from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'

import { createFunctionRegistry } from '../../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../../functions/spec.js'
import { ChatPinError, createPinOverlay, PIN_ACTION_CLASS_PREFIX } from '../pin-overlay.js'

/** The four REQUIRED ports, answering emptily — this file lists and never dispatches. */
function listingDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () =>
        Promise.resolve({
          schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
          configPath: 'agent-qa.config.yaml',
          entries: [],
        }),
    },
  }
}

const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

function realRegistry() {
  return createFunctionRegistry({ deps: listingDeps(), auditSink: noOpSink() })
}

function declarations(): readonly FunctionDeclaration[] {
  return realRegistry().list(FULLY_GRANTED)
}

function overlay() {
  return createPinOverlay(realRegistry(), FULLY_GRANTED)
}

/** An action descriptor as the GATE would see it: the risk name, verbatim. */
function actionNamed(riskName: string): RiskActionDescriptor {
  return { name: riskName, recognized: true }
}

// One real, registered op, taken off the walk rather than typed here. `PROTECTED_ACTION_CLASSES`
// is a schema constant already pinned to name real registered ops, which makes it a stable
// choice; its first member's bare form is the thing a person would type.
const SAMPLE_CLASS = PROTECTED_ACTION_CLASSES[0]
const SAMPLE_BARE = SAMPLE_CLASS.slice(PIN_ACTION_CLASS_PREFIX.length)

describe('the corpus is not vacuous', () => {
  it('the real registry lists ops, and every one carries an fn:-prefixed risk name', () => {
    const listed = declarations()

    expect(listed.length).toBeGreaterThan(0)
    for (const declaration of listed) {
      expect(declaration.risk.name).toBe(`${PIN_ACTION_CLASS_PREFIX}${declaration.id}`)
    }
    // The sample really is on the walk — otherwise every assertion below would be testing the
    // refusal path while claiming to test the accept path.
    expect(listed.map((declaration) => declaration.risk.name)).toContain(SAMPLE_CLASS)
  })
})

describe('normalisation', () => {
  it('records a bare op id in the fn:-prefixed spelling the gate compares against', () => {
    const held = overlay()

    expect(held.pin(SAMPLE_BARE)).toBe(SAMPLE_CLASS)
    expect(held.list().deniedActionClasses).toEqual([SAMPLE_CLASS])
  })

  it('accepts the already-prefixed spelling without doubling the prefix', () => {
    const held = overlay()

    expect(held.pin(SAMPLE_CLASS)).toBe(SAMPLE_CLASS)
    expect(held.list().deniedActionClasses).toEqual([SAMPLE_CLASS])
  })

  it('trims surrounding whitespace a REPL line carries in', () => {
    const held = overlay()

    expect(held.pin(`  ${SAMPLE_BARE}\t`)).toBe(SAMPLE_CLASS)
  })

  it('records a class once however many times it is pinned', () => {
    const held = overlay()

    held.pin(SAMPLE_BARE)
    held.pin(SAMPLE_CLASS)
    held.pin(` ${SAMPLE_BARE} `)

    expect(held.list().deniedActionClasses).toEqual([SAMPLE_CLASS])
  })
})

describe('the unknown-class refusal (the 391-05 silent-no-op trap)', () => {
  it('refuses a class no registered op declares, naming the input verbatim', () => {
    const held = overlay()
    const typed = 'files.delete'

    let raised: unknown
    try {
      held.pin(typed)
    } catch (error) {
      raised = error
    }

    expect(raised).toBeInstanceOf(ChatPinError)
    const pinError = raised as ChatPinError
    expect(pinError.input).toBe(typed)
    expect(pinError.message).toContain(typed)
    expect(pinError.knownActionClasses).toEqual(
      declarations().map((declaration) => declaration.risk.name),
    )
    // A refusal is not a quiet pin: nothing was recorded.
    expect(held.list().deniedActionClasses).toEqual([])
  })

  it('refuses the DOUBLE-prefixed spelling rather than repairing it', () => {
    const held = overlay()

    expect(() => held.pin(`${PIN_ACTION_CLASS_PREFIX}${SAMPLE_CLASS}`)).toThrow(ChatPinError)
    expect(held.list().deniedActionClasses).toEqual([])
  })

  it('refuses an empty or whitespace-only class', () => {
    const held = overlay()

    expect(() => held.pin('')).toThrow(ChatPinError)
    expect(() => held.pin('   ')).toThrow(ChatPinError)
    expect(held.list().deniedActionClasses).toEqual([])
  })

  it('refuses a class that is only a PREFIX of a real one — membership is exact', () => {
    const held = overlay()

    expect(() => held.pin(SAMPLE_BARE.split('.')[0])).toThrow(ChatPinError)
    expect(() => held.pin(`${SAMPLE_BARE}x`)).toThrow(ChatPinError)
    expect(held.list().deniedActionClasses).toEqual([])
  })
})

describe('the gate predicate', () => {
  it('answers false for every registered class while nothing is pinned', () => {
    const deny = overlay().asGateDeny()

    for (const declaration of declarations()) {
      expect(deny(actionNamed(declaration.risk.name))).toBe(false)
    }
  })

  it('denies exactly the pinned class and nothing else on the walk', () => {
    const held = overlay()
    held.pin(SAMPLE_BARE)
    const deny = held.asGateDeny()

    for (const declaration of declarations()) {
      expect({
        class: declaration.risk.name,
        denied: deny(actionNamed(declaration.risk.name)),
      }).toEqual({
        class: declaration.risk.name,
        denied: declaration.risk.name === SAMPLE_CLASS,
      })
    }
  })

  it('does not deny the BARE spelling — the trap, asserted from the gate side', () => {
    const held = overlay()
    held.pin(SAMPLE_BARE)
    const deny = held.asGateDeny()

    // The gate never sees a bare id: every op's risk name carries the prefix. Pinning the bare
    // form and denying on it would look identical from the REPL and protect nothing in production.
    expect(deny(actionNamed(SAMPLE_BARE))).toBe(false)
    expect(deny(actionNamed(SAMPLE_CLASS))).toBe(true)
  })

  it('is a LIVE view: a pin taken after the predicate is bound takes effect', () => {
    const held = overlay()
    const deny = held.asGateDeny()

    expect(deny(actionNamed(SAMPLE_CLASS))).toBe(false)
    held.pin(SAMPLE_BARE)
    // The composition root binds this hook once for the whole session, and the person types
    // `/pin` in the middle of it. A snapshot here would be empty forever.
    expect(deny(actionNamed(SAMPLE_CLASS))).toBe(true)
  })

  it('survives being detached from the holder', () => {
    const held = overlay()
    held.pin(SAMPLE_BARE)
    const { asGateDeny } = held

    expect(asGateDeny()(actionNamed(SAMPLE_CLASS))).toBe(true)
  })
})

describe('there is no way to loosen', () => {
  it('the type carries no unpin and no clear', () => {
    const held = overlay()
    held.pin(SAMPLE_BARE)

    // @ts-expect-error D-21: a pin cannot be lifted — it ends when the session does
    const unpin = held.unpin
    // @ts-expect-error D-21: and the set cannot be emptied either
    const clear = held.clear

    expect(unpin).toBeUndefined()
    expect(clear).toBeUndefined()
  })

  it('exposes exactly four members at runtime, so a fifth is a visible edit', () => {
    // The companion to the type claim above: a widened implementation would satisfy the two
    // directives (they only require the property to be absent from the TYPE) while shipping a
    // reachable loosen path.
    //
    // FOUR SINCE 392-14, and the set moved by a deliberate edit here — which is what this
    // assertion is for. `classFor` is the VALIDATION half of `pin`, split out so the engine's
    // directive batch pre-flight can ask whether a `/pin` will be accepted without recording it.
    // It writes nothing, so it loosens nothing; but a member arriving without this line moving
    // would be exactly the silent widening the case exists to catch.
    expect(Object.keys(overlay()).sort()).toEqual(['asGateDeny', 'classFor', 'list', 'pin'])
  })

  it('classFor VALIDATES without recording — asking is not pinning (392-14)', () => {
    // The property the batch pre-flight rests on. If `classFor` recorded, a turn refused by a
    // LATER directive would still have carried out the earlier one, which is the whole defect it
    // was split out to remove.
    const held = overlay()

    expect(held.classFor(SAMPLE_BARE)).toBe(SAMPLE_CLASS)
    expect(held.list().deniedActionClasses).toEqual([])
    expect(held.asGateDeny()(actionNamed(SAMPLE_CLASS))).toBe(false)

    // And it refuses exactly what `pin` refuses, by the same named error.
    expect(() => held.classFor('nonsense.notacapability')).toThrow(ChatPinError)
  })

  it('a returned snapshot cannot be written back through', () => {
    const held = overlay()
    held.pin(SAMPLE_BARE)
    const snapshot = held.list()

    expect(Object.isFrozen(snapshot.deniedActionClasses)).toBe(true)
    expect(() => (snapshot.deniedActionClasses as string[]).pop()).toThrow(TypeError)
    expect(held.list().deniedActionClasses).toEqual([SAMPLE_CLASS])
  })
})
