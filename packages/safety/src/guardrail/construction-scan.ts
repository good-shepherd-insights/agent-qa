import { sha256hex16, type GuardrailDetectorFamily } from '@vostride/agent-qa-schema'

import { createMaskingContext } from '../masking/context'
import { seedMaskingContext, type MaskingSeedSources } from '../masking/seed'
import { DETECTOR_PRECEDENCE, findDetectorMatches } from './detectors'

/**
 * The D-09 construction scan: does this artifact, as it will be surfaced to a person, carry a
 * secret? Run at proposal CONSTRUCTION, before any diff renders (CFGM-02).
 *
 * PURITY CONTRACT. `scanConstructedArtifact` is pure and synchronous. It performs no filesystem,
 * network, process or clock access, holds no module-level mutable state, and reads nothing but its
 * two arguments. Two invocations interleaved, or one interrupted halfway, cannot affect each other
 * or leave anything behind — there is nothing shared to corrupt. This is checked structurally: the
 * imports above resolve only inside this package and `@vostride/agent-qa-schema`.
 *
 * THE INPUT IS THE ARTIFACT, NOT THE EDIT (D-12). A part's `text` is the whole surfaced thing: the
 * entire unified diff for a file — context lines included — or the entire content of a new file for
 * scaffold. A secret a HUMAN committed months ago, sitting quietly on a context line three lines
 * above the change, blocks this proposal. CFGM-02's sentence is unqualified and scored on what
 * RENDERS, not on who authored the bytes. A scan whose input was "the changed lines" would pass an
 * artifact that displays a secret, which is the whole failure it exists to prevent.
 *
 * ONE LEXICON, TWO HALVES (D-09). Neither half is minted here:
 *
 *   - the SEEDED half asks the masker. `seedMaskingContext` — the same function, not a copy — walks
 *     the same `MaskingSeedSources` the run's masking context is built from, so the values this scan
 *     knows and the values the masker hides are the same set by construction. A scanner with its own
 *     seed list is the sibling-input gap this project keeps rediscovering: the two lists drift, and
 *     the drift is invisible until something leaks.
 *   - the PATTERN half asks `findDetectorMatches` — the shared detector engine behind `scan()` and
 *     the committed-egress guardrail. No regex is written in this file. A second lexicon here would
 *     mean a detector retune (see the credit-card float regression in `detectors.ts`) fixes one
 *     guardrail surface and not the other.
 *
 * NO POLICY ARGUMENT, DELIBERATELY. `scan()` layers a `GuardrailPolicy` over the detector engine to
 * answer "may this text leave the process to a model provider". That is NOT this question, and the
 * two must not share an answer: an operator who sets `awsKey: 'off'` because their provider traffic
 * is on a private link would, through a shared policy, silently disable the check that keeps an AWS
 * key out of a git commit. Conflating two questions with different blast radii into one knob is the
 * same shape as 395-02's "decide `unchanged` from the rendered line count". This scan consults the
 * detector families directly and always.
 *
 * REPORT PRECEDENCE, fixed so two runs never disagree: for each part in the order given, the seeded
 * findings first (seed values ordered longest-first, ties broken by code-unit order), then the
 * pattern findings in `DETECTOR_PRECEDENCE` order, at most one per family per part. Nothing here
 * reads a Set or object iteration order that a caller could perturb.
 *
 * THE REPORT NAMES, IT DOES NOT CARRY (D-10, T-395-06). A finding is a label, an optional field, a
 * detector id and a `redactedFingerprint` — `sha256hex16` of the matched value, the same idiom
 * `scan()` uses, non-reversing and disclosing no prefix of the value. The blocked proposal record
 * this report becomes is PERSISTED, so a finding that quoted its secret would outlive the proposal
 * it refused and re-create the disclosure the block exists to prevent.
 *
 * WHAT THIS DOES NOT CATCH, stated rather than implied. A credential that is neither seeded nor
 * shaped like one of the families below is missed — the pattern half can only refuse shapes it can
 * NAME, and naming more shapes never reaches zero. The seeded half is what makes that bound
 * tolerable: it catches an arbitrarily-shaped value with no lexicon entry at all, provided the
 * composition root seeded it. Both bounds are pinned by cells in
 * `__tests__/construction-scan.test.ts` so they stay conscious.
 */

/** The detector id for a value the masker already knows — not a `GuardrailDetectorFamily`. */
export const SEEDED_SECRET_DETECTOR = 'seeded-secret'

export type ConstructionScanDetector = GuardrailDetectorFamily | typeof SEEDED_SECRET_DETECTOR

/**
 * Detector families deliberately NOT consulted at construction. Pinned with the reason, per the
 * standing rule for tuned constants (386 D-15); retuning is an edit here, never a caller flag.
 *
 *   - `email` is PII, not a credential. Config files legitimately carry maintainer addresses,
 *     notification targets and example values; blocking on one would refuse most real config
 *     changes, and a guardrail that refuses everything gets turned off.
 *   - `injectionShape` is documented in `detectors.ts` as a SOFT routing signal whose match "costs
 *     Curator review rather than causing a deterministic rejection". Promoting it to a hard block
 *     on a different surface would use it against its own stated contract.
 *
 * The scanned set is derived by EXCLUSION from `DETECTOR_PRECEDENCE`, so a family added to the
 * shared engine tomorrow is scanned here by default. The default direction is deliberate: an
 * opt-in list would silently leave every new detector out of the commit-time check.
 */
export const CONSTRUCTION_SCAN_EXCLUDED_DETECTORS: readonly GuardrailDetectorFamily[] = [
  'email',
  'injectionShape',
]

export const CONSTRUCTION_SCAN_DETECTORS: readonly GuardrailDetectorFamily[] =
  DETECTOR_PRECEDENCE.filter((family) => !CONSTRUCTION_SCAN_EXCLUDED_DETECTORS.includes(family))

/**
 * One surfaced artifact section. `label` is what a person is told to go look at — a
 * workspace-relative file path — and maps 1:1 onto `ConfigScanFinding.path` in the schema package's
 * blocked arm. `text` is the WHOLE section (see the file header).
 */
export interface ConstructionScanPart {
  label: string
  text: string
  field?: string
}

export interface ConstructionScanFinding {
  label: string
  field?: string
  detector: ConstructionScanDetector
  /** `sha256hex16` of the matched value. Never the value, never a prefix of it. */
  redactedFingerprint: string
}

export interface ConstructionScanReport {
  findings: readonly ConstructionScanFinding[]
}

/**
 * The seed values this scan will look for, admitted by the MASKER'S OWN guard rather than a
 * length constant restated here.
 *
 * `createMaskingContext()` refuses to register a value below its `minRegisteredLength`. Rather than
 * copy that number — a copy is a thing that drifts — a real context is used as the admissions
 * oracle: register the value, then ask whether masking it changes it. It changes iff the context
 * accepted it. So the scan's floor IS the masker's floor, whatever the masker's floor becomes.
 *
 * The consequence is inherited honestly: a short seeded value the masker declines to hide is also a
 * value this scan declines to look for. Pinned by the below-the-floor cell.
 */
function collectSeededValues(seeds: MaskingSeedSources): string[] {
  const admissions = createMaskingContext()
  const seen = new Set<string>()
  const admitted: string[] = []

  seedMaskingContext(
    {
      register(value, category) {
        if (seen.has(value)) return
        seen.add(value)
        admissions.register(value, category)
        if (admissions.mask(value) !== value) admitted.push(value)
      },
    },
    seeds,
  )

  admissions.dispose()

  return admitted.sort(
    (left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0),
  )
}

export function scanConstructedArtifact(
  parts: readonly ConstructionScanPart[],
  seeds: MaskingSeedSources,
): ConstructionScanReport {
  const seededValues = collectSeededValues(seeds)
  const findings: ConstructionScanFinding[] = []

  for (const part of parts) {
    for (const value of seededValues) {
      if (!part.text.includes(value)) continue
      findings.push(finding(part, SEEDED_SECRET_DETECTOR, value))
    }

    for (const family of CONSTRUCTION_SCAN_DETECTORS) {
      const matches = findDetectorMatches(family, part.text)
      if (matches.length === 0) continue
      findings.push(finding(part, family, matches[0].value))
    }
  }

  return { findings }
}

function finding(
  part: ConstructionScanPart,
  detector: ConstructionScanDetector,
  value: string,
): ConstructionScanFinding {
  const built: ConstructionScanFinding = {
    label: part.label,
    detector,
    redactedFingerprint: sha256hex16(value),
  }

  if (part.field !== undefined) built.field = part.field

  return built
}
