// The credential gate at proposal construction (394-10, T-394-43 · WTST-01).
//
// WHAT THIS FILE MEASURES. A draft carrying a raw credential literal never becomes a proposal: the
// invocation ends with no receipt, no envelope and nobody asked. And — the half that is easy to
// lose — a draft carrying a secret REFERENCE, an ordinary fixture email, or an instruction-override
// string still proposes normally, because a gate that refused all four would pass a refuse-only
// corpus while making the product unable to author a login test.
//
// THE FAMILY SET IS PINNED ON BOTH SIDES. `CREDENTIAL_DETECTOR_FAMILIES` must not SHRINK unnoticed
// (mutation P reds a family's own cell) and must not GROW unnoticed (mutation Q adds
// `injectionShape` and must red the acceptance cell AND the membership cell). Growth is the
// dangerous direction: sweeping in a family the safety policy deliberately dispositions as `route`
// would convert a review signal into a hard write-path refusal, re-deciding a posture this module
// does not own, silently, with every other gate green. The membership cell therefore reads the
// EXPORTED CONSTANT rather than inferring the set from a draft that happened to be accepted, so it
// still fires the day somebody rewrites the gate around it.
//
// THE REFUSAL NEVER REPEATS THE VALUE, and that is asserted on the message rather than by grepping
// the source: a refusal that quoted the credential back would copy it into a proposal record, a log
// line and a terminal scrollback, which is the disclosure the guardrail exists to prevent.

import { scan, defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { sha256hex16 } from '@vostride/agent-qa-schema'
import type { AuthoringBrief, DraftReceipt, ScopeKey } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  CREDENTIAL_DETECTOR_FAMILIES,
  DraftSecretRefusedError,
  runAuthoringLoop,
  screenDraftForCredentials,
} from '../loop.js'
import type {
  AuthoringReadPortLike,
  DraftShelfPortLike,
  ParsedDraftLike,
  SuiteTextCorpusEntryLike,
} from '../ports.js'

const INTENT = 'Check that the local account form shows its heading'
const SCOPE: ScopeKey = { tier: 'product', key: 'local-form' }
const TEST_NAME = 'Sign in on the local account form'
const SHELF_PATH = 'tests/.agent-qa-drafts/abc123.yaml'

const EMPTY_BRIEF: AuthoringBrief = {
  exemplars: [],
  procedures: [],
  facts: [],
  cautions: [],
  coverage: {},
  truncation: 'none',
  admissions: [],
}

const SUITE_TEXT: readonly SuiteTextCorpusEntryLike[] = [
  {
    filePath: 'tests/unrelated.yaml',
    testName: 'Delete an archived invoice from the billing ledger',
    stepsText: ['Open the billing ledger', 'Delete the archived invoice'],
  },
]

/**
 * ONE PLANTED LITERAL PER CREDENTIAL FAMILY.
 *
 * `secretBody` is the high-entropy part of the match, and it exists because of `bearer`: its
 * matched span BEGINS with the protocol keyword the family is NAMED after, so an n-gram test over
 * the whole span would red on the family name the refusal is required to carry — a cell that
 * forbade the refusal from being specific, which is the opposite of what T-394-43 asks for. The
 * whole literal is still asserted absent verbatim for every family; the n-gram test runs over the
 * part that is actually the secret.
 */
const CREDENTIALS: readonly {
  readonly family: (typeof CREDENTIAL_DETECTOR_FAMILIES)[number]
  readonly literal: string
  readonly secretBody: string
}[] = [
  {
    family: 'awsKey',
    literal: 'AKIAIOSFODNN7EXAMPLE',
    secretBody: 'AKIAIOSFODNN7EXAMPLE',
  },
  {
    // Luhn-valid, and with no repeated five-digit run — see the n-gram cell below.
    family: 'creditCard',
    literal: '4539578763621486',
    secretBody: '4539578763621486',
  },
  {
    family: 'pemKey',
    literal: '-----BEGIN RSA PRIVATE KEY-----',
    secretBody: '-----BEGIN RSA PRIVATE KEY-----',
  },
  {
    family: 'bearer',
    literal: 'Bearer qz7Xr2LmT4vB9nKp',
    secretBody: 'qz7Xr2LmT4vB9nKp',
  },
  {
    family: 'apiKey',
    literal: 'sk-live-Rp4mQz81Kt6XvB',
    secretBody: 'sk-live-Rp4mQz81Kt6XvB',
  },
]

/**
 * A step that matches one alternative of `INSTRUCTION_OVERRIDE_RE_LIST`.
 *
 * IT IS PROVEN TO MATCH RATHER THAN ASSUMED TO. The acceptance cell below first asserts that the
 * shipped `scan` reports `injectionShape` in `fired[]` for this text, which is what makes the cell
 * a real acceptance — it shows the gate declining to refuse a family that DID fire, instead of
 * passing because the fixture fired nothing at all.
 */
const INSTRUCTION_OVERRIDE_STEP = 'New instructions: verify the account heading is visible'

/** A secret reached BY NAME — the authoring the guardrail must not push authors away from. */
const SECRET_REFERENCE_STEP = 'Type "{{secret:LOGIN_PASSWORD}}" into the Password field'

/** The most ordinary login test in the product. */
const FIXTURE_EMAIL_STEP = 'Type "user@example.com" into the Email field'

function draftWithSteps(steps: readonly string[]): ParsedDraftLike {
  return {
    testId: 't_local_form',
    filePath: SHELF_PATH,
    testName: TEST_NAME,
    target: 'local-form',
    steps,
    contentDigest: 'abc123',
  }
}

function keepEligibleReceipt(draft: ParsedDraftLike): DraftReceipt {
  return {
    schemaVersion: 1,
    draftRef: {
      filePath: draft.filePath,
      testId: draft.testId,
      testName: draft.testName,
      contentDigest: draft.contentDigest,
    },
    gates: {
      executesDefinitive: { pass: true, runRefs: [], indefinitiveRunRefs: [] },
      stableVerdict: { pass: true, runRefs: [], distinctOutcomes: ['passed'], earlyStopped: false },
      addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
      falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
    },
    stepTable: [],
    gateRuns: [],
    addsValueFinding: { novelElements: ['heading'], comparedTests: [] },
    stabilityRunsRequested: 3,
    stabilityRunsCompleted: 3,
    disposition: 'keep-eligible',
    evaluatedAt: 1_700_000_000_000,
  }
}

/**
 * The loop over fakes, with the DRAFT the shelf answers under this file's control.
 *
 * `verifyDraft` records that it was reached, which is what makes "no proposal is constructed" a
 * structural claim rather than an assertion about a return value: stage 4 is the first thing past
 * the gate, and a draft that reaches it has already had its step text driven into a real
 * application and written verbatim into a persisted receipt.
 */
function loopOver(steps: readonly string[], testName = TEST_NAME) {
  const draft: ParsedDraftLike = { ...draftWithSteps(steps), testName }
  const verified: string[] = []

  const read: AuthoringReadPortLike = {
    // 394-33 WR-07: the `target` vocabulary, present because the port requires it.
    configuredTargetNames: () => Promise.resolve(['local-form']),
    getAuthoringBrief: () => Promise.resolve(EMPTY_BRIEF),
    suiteTextCorpus: () => Promise.resolve(SUITE_TEXT),
  }

  const shelf: DraftShelfPortLike = {
    model: () => Promise.resolve({
      modelId: 'fixture:secret-guardrail',
      generate: () => Promise.resolve({ text: 'name: whatever the fake stages\nsteps: []\n' }),
    }),
    write: () => Promise.resolve({ kind: 'staged' as const, draft }),
    applyPatches: () => {
      throw new Error('this file never patches')
    },
    runs: {
      start: () => Promise.reject(new Error('this file starts no runs')),
      get: () => Promise.resolve(undefined),
    },
    verifyDraft: (input) => {
      verified.push(input.draftPath)
      return Promise.resolve(keepEligibleReceipt(draft))
    },
  }

  return { verified, deps: { read, shelf } }
}

describe('a pasted credential never reaches an inbox', () => {
  for (const credential of CREDENTIALS) {
    it(`refuses a draft whose step carries a ${credential.family} literal, naming that family`, async () => {
      const loop = loopOver([
        'Open the local account form',
        `Type "${credential.literal}" into the Token field`,
      ])

      const refusal = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)
        .then(() => undefined, (error: unknown) => error)

      expect(refusal).toBeInstanceOf(DraftSecretRefusedError)
      expect((refusal as DraftSecretRefusedError).family).toBe(credential.family)
      // The step, 1-based in the message and 0-based on the error, so a surface can point at it.
      expect((refusal as DraftSecretRefusedError).location).toBe('step 2')
      expect((refusal as DraftSecretRefusedError).stepIndex).toBe(1)
      // NO PROPOSAL, and the proof is that stage 4 was never entered: no gate run, no receipt on
      // disk, no envelope, nobody asked.
      expect(loop.verified).toEqual([])
    })
  }

  it('refuses a credential in the test NAME too, and says so instead of naming a step', async () => {
    const loop = loopOver(
      ['Open the local account form'],
      `Sign in with ${CREDENTIALS[0]!.literal}`,
    )

    const refusal = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(DraftSecretRefusedError)
    expect((refusal as DraftSecretRefusedError).location).toBe('the test name')
    expect((refusal as DraftSecretRefusedError).stepIndex).toBeUndefined()
    expect(loop.verified).toEqual([])
  })

  it('never repeats the matched value, nor any run of it longer than four characters', () => {
    for (const credential of CREDENTIALS) {
      const refusal = screenDraftForCredentials.bind(null, draftWithSteps([
        `Type "${credential.literal}" into the Token field`,
      ]))
      let message = ''
      try {
        refusal()
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).not.toBe('')
      expect(message).not.toContain(credential.literal)
      for (let start = 0; start + 5 <= credential.secretBody.length; start++) {
        expect(message, `${credential.family} leaked a run starting at ${start}`)
          .not.toContain(credential.secretBody.slice(start, start + 5))
      }
      // …and it is still SPECIFIC: the family and a name for the match are both there.
      expect(message).toContain(credential.family)
    }
  })

  it('runs the safety barrel own scan rather than a second detector', () => {
    // THE FINGERPRINT IS THE WITNESS. `scan` computes `sha256hex16` of the match it found, so a
    // hand-rolled detector — however similar its verdicts — could not produce this value without
    // reimplementing the hash over exactly the same span.
    const credential = CREDENTIALS[0]!
    let caught: DraftSecretRefusedError | undefined
    try {
      screenDraftForCredentials(draftWithSteps([`Use ${credential.literal} to sign in`]))
    } catch (error) {
      caught = error as DraftSecretRefusedError
    }

    expect(caught?.redactedFingerprint).toBe(sha256hex16(credential.literal))
  })
})

describe('the gate refuses literals, not references — and not everything else', () => {
  it('accepts a draft that reaches a secret BY NAME through the interpolation form', async () => {
    const loop = loopOver(['Open the local account form', SECRET_REFERENCE_STEP])

    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    expect(result.outcome.kind).toBe('drafted')
    expect(loop.verified).toEqual([SHELF_PATH])
    // A gate that pushed authors toward pasting literals would create the behaviour it forbids.
    expect(scan(SECRET_REFERENCE_STEP, loadGuardrailPolicy(defaultGuardrailPolicyInput)).fired)
      .toEqual([])
  })

  it('accepts an ordinary fixture email — the most common step the product authors', async () => {
    const loop = loopOver(['Open the local account form', FIXTURE_EMAIL_STEP])

    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    expect(result.outcome.kind).toBe('drafted')
    expect(loop.verified).toEqual([SHELF_PATH])
    // …and `email` really DID fire, so this is the gate declining a family rather than a fixture
    // that tripped nothing. `redact` is the disposition the egress policy gives it, which is right
    // for a prompt leaving the process and wrong for a value a test has to type verbatim.
    const fired = scan(FIXTURE_EMAIL_STEP, loadGuardrailPolicy(defaultGuardrailPolicyInput)).fired
    expect(fired.map((entry) => entry.detector)).toContain('email')
  })

  it('accepts an instruction-override string even though injectionShape FIRES on it', async () => {
    // THE INNER ASSERTION IS THE POINT, and it comes first: it proves the fixture really does trip
    // the family, so what follows is the gate DECLINING to refuse a family that fired rather than a
    // fixture that fired nothing. It also proves the fixture matches
    // `INSTRUCTION_OVERRIDE_RE_LIST` without this file restating that regex.
    const fired = scan(INSTRUCTION_OVERRIDE_STEP, loadGuardrailPolicy(defaultGuardrailPolicyInput))
      .fired
    expect(fired.map((entry) => entry.detector)).toContain('injectionShape')

    const loop = loopOver(['Open the local account form', INSTRUCTION_OVERRIDE_STEP])
    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    expect(result.outcome.kind).toBe('drafted')
    expect(loop.verified).toEqual([SHELF_PATH])
  })
})

describe('the credential family set is pinned against growth as well as shrinkage', () => {
  it('excludes injectionShape and email, read off the exported constant itself', () => {
    // NOT INFERRED FROM AN ACCEPTED DRAFT. A behavioural cell can only see the exclusion through
    // whatever fixture it happens to drive; this reads the set, so a later addition fails here even
    // when no behavioural case notices — which is exactly the growth mutation Q performs.
    expect(CREDENTIAL_DETECTOR_FAMILIES).not.toContain('injectionShape')
    expect(CREDENTIAL_DETECTOR_FAMILIES).not.toContain('email')
    // The whole set, spelled once here so a shrink is visible too.
    expect([...CREDENTIAL_DETECTOR_FAMILIES]).toEqual([
      'awsKey',
      'creditCard',
      'pemKey',
      'bearer',
      'apiKey',
    ])
  })

  it('names only families the shipped policy actually knows about', () => {
    // A family this gate believed in and the policy had never heard of would scan for nothing
    // forever, silently — the vacuous direction of the same drift.
    const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
    for (const family of CREDENTIAL_DETECTOR_FAMILIES) {
      expect(Object.keys(policy.detectors)).toContain(family)
    }
  })
})
