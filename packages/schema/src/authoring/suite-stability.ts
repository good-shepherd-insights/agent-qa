// The mixed-verdict suite-stability read (394, D-14 · WTST-05).
//
// WHAT IT IS FOR. Gate 2 flips: the draft passed on one run and failed on another, so the keep
// filter rejects it. The naive answer is to discard the draft silently, and it is the wrong one
// often enough to matter — a target whose EXISTING tests are already flaky or quarantined is a
// target where the application is unstable, and the honest message names that rather than telling
// an author their test was no good. "Your app is unstable here, and these are the neighbours that
// say so" and "your draft did not pass" are two different sentences, and the author can only act
// on one of them.
//
// (That pair is spelled as two quoted clauses joined by `and`, never with the import keyword
// between a word and a quoted phrase, because the arch dependency scan reads import specifiers
// out of RAW BYTES with comments included, and prose shaped like a specifier is reported as an
// undeclared external dependency. Fourth occurrence of that trap in this phase, all four in
// prose — and the fifth was this very paragraph, when it first illustrated the shape verbatim.)
//
// IT STARTS ZERO RUNS, AND THAT IS THE WHOLE REASON D-14 IS READ-SIDE. WTST-08's fan-out preview
// promises a bound before dispatch and the receipt reports what was spent; a stability check that
// took its own runs would make the preview a number nobody could honour. Everything below is a
// pure fold over evidence the project ALREADY has — the run-outcome projection and the quarantine
// ledger — which is why it lives in `schema` and takes rows rather than ports.
//
// A DEGRADED POSTURE STATED IS NOT A CLEAN BILL OF HEALTH. A target with no history gets
// `no-history` and says so. Returning `stable` for a target nothing has ever observed would be a
// wrong answer wearing a correct one's clothes, and it is the one this vocabulary exists to make
// unrepresentable: `stable` means evidence was read and it said stable.
//
// THE RESULT NAMES ITS EVIDENCE. `flakyNeighbours` carries identities, not a count and not a
// boolean — an author told "some neighbours are flaky" cannot go and look, and the whole value of
// this branch is that they can.

/**
 * The CLOSED posture vocabulary. Three members, and none of them covers another.
 *
 *   `stable`           the target's existing tests were read and none is flaky or quarantined.
 *   `neighbours-flaky` at least one existing test flips or sits in quarantine — the app is the
 *                      likelier explanation for the draft's own flip.
 *   `no-history`       nothing has ever been observed about this target. Honestly degraded.
 */
export const SUITE_STABILITY_POSTURES = ['stable', 'neighbours-flaky', 'no-history'] as const

export type SuiteStabilityPosture = (typeof SUITE_STABILITY_POSTURES)[number]

/** Why one neighbour counts as unstable. Closed, because the message names the reason. */
export const NEIGHBOUR_INSTABILITY_REASONS = ['quarantined', 'verdict-flip'] as const

export type NeighbourInstabilityReason = (typeof NEIGHBOUR_INSTABILITY_REASONS)[number]

/**
 * One existing test in the target suite, with what the project already knows about it.
 *
 * `outcomes` are recorded MEMBER outcomes, newest last, in the run store's own words — a free
 * string rather than an enum for the reason `FindingProposalV1.verdictSource` is one: the runner
 * owns that vocabulary and grows it, and a closed copy here would read a newer runner's outcome
 * as unknown. More than one DISTINCT value is a flip; the values themselves are never compared
 * against a member list this file maintains.
 *
 * An EMPTY `outcomes` array is "nothing recorded", never "recorded as fine".
 */
export interface SuiteNeighbourRow {
  readonly filePath: string
  readonly testName: string
  readonly outcomes: readonly string[]
  readonly quarantined: boolean
}

/** One named neighbour, with the reason and the evidence that produced it. */
export interface FlakyNeighbour {
  readonly filePath: string
  readonly testName: string
  /**
   * The `entities.resolve` reference, spelled `<filePath>::<testName>`.
   *
   * Deliberately NOT a `TST-###` short-ID: a short-ID exists only once something has sighted the
   * entity, and no `TST` sighting source is wired on any host in this build — so printing one
   * would publish an address that resolves to nothing (ENTY-01's never-guess law).
   */
  readonly ref: string
  readonly reason: NeighbourInstabilityReason
  /** The distinct outcomes observed, when the reason is a flip. Empty for a quarantine entry. */
  readonly distinctOutcomes: readonly string[]
}

export interface SuiteStabilityAssessment {
  readonly posture: SuiteStabilityPosture
  /** NAMED, never counted. Empty for `stable` and for `no-history`. */
  readonly flakyNeighbours: readonly FlakyNeighbour[]
  /** The sentence a surface prints. One producer, so chat and the CLI say the same thing. */
  readonly message: string
}

export interface SuiteStabilityInput {
  /** The suite file the draft targets — what the message names. */
  readonly targetFilePath: string
  /** The target's EXISTING tests. Empty means the target has no existing tests at all. */
  readonly neighbours: readonly SuiteNeighbourRow[]
}

/** `<filePath>::<testName>` — the one spelling, minted here so no surface invents a second. */
export function suiteTestRef(filePath: string, testName: string): string {
  return `${filePath}::${testName}`
}

function classify(row: SuiteNeighbourRow): FlakyNeighbour | undefined {
  const distinct = [...new Set(row.outcomes)]
  // QUARANTINE FIRST. A quarantined test may well have a single recorded outcome — that is what
  // quarantining it achieved — so reading the outcomes first would report it stable.
  if (row.quarantined) {
    return {
      filePath: row.filePath,
      testName: row.testName,
      ref: suiteTestRef(row.filePath, row.testName),
      reason: 'quarantined',
      distinctOutcomes: [],
    }
  }
  if (distinct.length > 1) {
    return {
      filePath: row.filePath,
      testName: row.testName,
      ref: suiteTestRef(row.filePath, row.testName),
      reason: 'verdict-flip',
      distinctOutcomes: distinct,
    }
  }
  return undefined
}

/**
 * Assess the target's existing tests. PURE, TOTAL, AND IT STARTS NOTHING.
 *
 * Order of decision, and it is order-sensitive exactly as written: any flaky neighbour wins,
 * because one unstable neighbour is enough to make the application the likelier explanation.
 * Only when nothing is flaky does the absence of evidence get to speak.
 */
export function assessSuiteStability(input: SuiteStabilityInput): SuiteStabilityAssessment {
  const flakyNeighbours = input.neighbours
    .map(classify)
    .filter((row): row is FlakyNeighbour => row !== undefined)

  if (flakyNeighbours.length > 0) {
    const named = flakyNeighbours
      .map((row) => `${row.ref} (${row.reason})`)
      .join(', ')
    return {
      posture: 'neighbours-flaky',
      flakyNeighbours,
      message:
        `Your app is unstable at ${input.targetFilePath}: ${flakyNeighbours.length} existing `
        + `test${flakyNeighbours.length === 1 ? '' : 's'} there already flip or sit in `
        + `quarantine — ${named}. The draft's own verdict flip is more likely the application `
        + 'than the draft.',
    }
  }

  const observed = input.neighbours.some((row) => row.outcomes.length > 0)
  if (!observed) {
    return {
      posture: 'no-history',
      flakyNeighbours: [],
      message:
        `No stability history for ${input.targetFilePath}: nothing here has a recorded outcome `
        + 'yet, so there is no evidence either way about whether the application is stable. This '
        + 'is a degraded read, not a clean bill of health.',
    }
  }

  return {
    posture: 'stable',
    flakyNeighbours: [],
    message:
      `The existing tests at ${input.targetFilePath} have stable recorded outcomes and none is `
      + 'quarantined, so the draft\'s verdict flip is not explained by its neighbours.',
  }
}
