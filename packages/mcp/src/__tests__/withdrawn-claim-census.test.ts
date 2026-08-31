// THE STANDING WITHDRAWN-CLAIM CENSUS — 408-08 must-have truth 4, as a gate rather than a hand check
// (Phase 408 plan 15 · MCPA-01 · D-01 / D-14 · T-408-28 / T-408-29 / T-408-30).
//
// WHY THIS FILE EXISTS. 408-08 truth 4 is a UNIVERSAL: "no claim survives in shipped prose that
// describes a property of the CALLER as a property of THIS SERVER." 408-08 checked it BY HAND,
// corrected five sites carefully, and never swept the rest — and `408-VERIFICATION.md` gaps[0] then
// re-opened it by direct measurement at four further sites the hand check missed
// (`app-resource.ts:37`, `scenario-table.ts:1233`, `parity.test.ts:1046`,
// `token-absence.test.ts:4-6`). Four more comment edits would make those four measured
// counterexamples go away; they would not make a universal true, and they would not stop a fifth
// site being written tomorrow. A universal is worth exactly as much as the cell that reds when
// somebody restates it. This is that cell.
//
// THE CLAIM THAT WAS WITHDRAWN, AND WHAT REPLACED IT. The withdrawn claim is "a minted `liveUrl`
// reaches a person ONLY through the document a host renders" — a statement about what the CALLER
// does with a document it asked for, dressed as a property of this server. It was withdrawn on
// 2026-09-01 by the gap-round ruling recorded in `../app-resource.ts`'s header ("THE 2026-09-01
// GAP-ROUND RULING — ROAD `demote`"). What holds in its place is narrower and verifiable: this
// server writes the token into exactly ONE place, the `src` of the frame in the document the
// `ui://` read serves, and that door is bounded at registration by `visibleToCaller` over the
// registry's declared scopes plus a bound mint. What a caller then does with the bytes it asked
// for is outside this server's reach, and prose that says otherwise over-claims a control — which
// 408-08's own prohibition names as worse than a named absence, "because it stops a reader from
// looking further".
//
// ==================================================================================================
// THE GATED SUBSET — what this census does NOT measure, said before anything it does
// ==================================================================================================
//
// 408-08 truth 4 is worded over both halves of its own parenthetical: "whether the served document
// is host-rendered HTML or model-readable text". THIS FILE GATES THE HOST-RENDERED-HTML HALF, and
// only that half. The signature vocabulary below is built from CHANNEL cues about the wrapper
// document — `host-rendered`, `host paints`, `the HOST renders`, `HTML the host` — so a claim that
// over-stated what the MODEL can read would match none of them and would pass this census
// untouched.
//
// The model-readable-text half of the PROSE universal is gated by no cell in this round. The
// underlying FACT for that half IS gated, but elsewhere and by a different measurement:
// `token-absence.test.ts`'s `SCANNED_CHANNELS` / `FLOW_CHANNELS` partition drives a full MCP flow
// and asserts that no model-readable channel this server emits carries a byte of any token the flow
// really minted. That measures the FACT. It does not measure the honesty of the prose describing
// the fact, which is what a census of this shape is for.
//
// So, plainly: a reader who takes a green run here as "408-08 truth 4 is now mechanised, entire"
// has read this file for more than it measures. A census header that over-claimed its own reach
// would be this round's own defect one level up, and it is refused here in the same terms.
//
// ==================================================================================================
// WHAT THE GATE PROVES, AND ITS RESIDUE
// ==================================================================================================
//
// `(W3)` proves that a dated supersession marker is PRESENT in the claim's own prose unit. It does
// not — and cannot — prove the marker is well written. A reader determined to defeat it could write
// the date and a strike word and mean neither. What it buys is that the defect which actually
// happened twice in this phase — a restatement shipped with NO marker at all, in a unit whose
// neighbour had one — cannot happen a third time silently.
//
// THE SELF-REFERENCE PROBLEM, SOLVED THE WAY `sep-citation.test.ts` SOLVES IT. This file must quote
// the withdrawn claim in order to sweep for it, so it would red on itself. It excludes exactly ONE
// path, by absolute path identity — see `CENSUS_SELF_EXCLUSION` — and `(W0)` asserts that exclusion
// is exactly one entry long, so it cannot grow into a whitelist without the diff saying so.
// `sep-citation.test.ts` states the same fact about its own sweep: "prose in this repository must
// cite MCPS-07 or a SEP number rather than restate a retired spelling, or the sweep would red on
// the explanation of the sweep."
//
// THE SEGMENTER RULE THAT DEVIATES FROM 408-15-PLAN.md, RECORDED RATHER THAN SILENT. The plan's
// task 1a step 5 lists four cut rules, and rule (b) — "cut at a blank comment line" — contradicts
// the plan's own two other statements that the unit is the comment BLOCK and not the paragraph, and
// its statement that "`app-resource.ts`'s header is ONE contiguous comment run from :1 to past
// :130" (which is only true if a bare `//` does not cut). Rule (b) is therefore NOT implemented: a
// paragraph-granular unit would red on `mapping.ts` :26-45 and `scenario-table.ts` :178-209, whose
// claim and whose dated correction sit in DIFFERENT PARAGRAPHS of the SAME comment block — two
// sites the phase verifier certified as correctly reconciled. Rules (a), (c) and (d) are
// implemented exactly as written, and rule (d) is the one this whole gate turns on.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const THIS_FILE = fileURLToPath(import.meta.url)
const TESTS_DIR = dirname(THIS_FILE)

/**
 * The workspace `packages/` root.
 *
 * `packages/mcp/src/__tests__` is three levels below `packages/`, so this resolves there and
 * nowhere else. `(W0)` floors the resolved denominator precisely because a root that lands one
 * level too deep (`packages/mcp/`, 33 files today) would make every absence `(W3)` reports vacuous
 * while the suite still reported green.
 */
const PACKAGES_ROOT = resolve(TESTS_DIR, '../../..')

/**
 * The ONE path excluded from the sweep, by absolute path identity and never by a name pattern.
 *
 * This file necessarily quotes the withdrawn claim in `ASSERTING_PROSE_FIXTURES` in order to sweep
 * for it, so without this exclusion the sweep would red on the explanation of the sweep — the same
 * fact `sep-citation.test.ts` records about its own retired-spelling blocklist. It is a frozen
 * ONE-element array and `(W0)` asserts its length, so the exclusion cannot quietly grow into a
 * whitelist: a second entry is a finding that belongs in a SUMMARY, not a silent line in a diff.
 */
const CENSUS_SELF_EXCLUSION: readonly string[] = Object.freeze([THIS_FILE])

/**
 * Every `<package>/src` directory in the workspace, produced by reading `packages/` rather than
 * typed out.
 *
 * THE SURFACE DECISION, AND WHY IT IS THE BROAD ONE. The narrow alternative — sweeping only the
 * three packages where the withdrawn claim demonstrably went (`mcp`, `cli`, and whatever carries
 * the next restatement) — is rejected. The defect this gate exists to catch is a FIFTH site written
 * tomorrow, and a surface that excludes the place tomorrow's site lands is a gate that cannot catch
 * it. The measured fact that makes the broad choice free: a whole-workspace sweep for the channel
 * vocabulary today hits exactly EIGHT files, all of them known and enumerated in
 * `KNOWN_CLAIM_SITES`' five plus the three innocent carriers, so the broad surface costs no false
 * positives at all.
 */
const SWEEP_ROOTS: readonly string[] = Object.freeze(
  readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => join(PACKAGES_ROOT, entry.name, 'src'))
    .filter((dir) => existsSync(dir))
    .sort(),
)

/** A channel cue: prose naming the document the host paints. On its own this is a FACT, not a claim. */
const CHANNEL_CUES: readonly string[] = Object.freeze([
  'host-rendered',
  'host paints',
  'the HOST renders',
  'HTML the host',
])

/**
 * The withdrawn claim's vocabulary, in `UNPROJECTED_REASON_SIGNATURES`' shape: a frozen, ORDERED
 * list of `[key, { channel, exclusivity }]` matched first-hit-wins over normalized unit text.
 *
 * WHY IT IS A PAIR AND NOT A WORD. The claim is NOT identified by the adjective "host-rendered".
 * That adjective appears in six measured places in this repository as an honest DESCRIPTION of the
 * wrapper document (see `INNOCENT_PROSE_FIXTURES`), and a signature that matched it alone would red
 * on `app-wrapper.ts`'s first paragraph. The claim is identified by an EXCLUSIVITY cue BOUND to a
 * channel cue: "the token goes ONLY here" is the over-claim; "the document is host-rendered" is a
 * fact. A unit matches only when both are present.
 *
 * THIS LIST IS A BOUND, NOT A COMPLETION — the same thing `RETIRED_SPEC_TAG_SPELLINGS` says about
 * itself in `sep-citation.test.ts`. It was seeded from the EIGHT measured occurrences in this
 * repository. A claim restated in vocabulary outside it would not be caught, and adding a member
 * makes this list longer, never complete. `ASSERTING_PROSE_FIXTURES` is what keeps the bound honest
 * as the prose it was built from changes.
 */
const WITHDRAWN_CLAIM_SIGNATURES: readonly (readonly [
  string,
  { readonly channel: readonly string[]; readonly exclusivity: readonly string[] },
])[] = Object.freeze([
  Object.freeze([
    'reaches-a-person-only',
    Object.freeze({ channel: CHANNEL_CUES, exclusivity: Object.freeze(['reaches a person only']) }),
  ] as const),
  Object.freeze([
    'lands-only-in-host-rendered',
    Object.freeze({
      channel: CHANNEL_CUES,
      exclusivity: Object.freeze(['lands only', 'lands in host-rendered']),
    }),
  ] as const),
  Object.freeze([
    'only-in-host-rendered',
    Object.freeze({
      channel: CHANNEL_CUES,
      exclusivity: Object.freeze([
        'only through host-rendered',
        'only in host-rendered',
        'confined to host-rendered',
      ]),
    }),
  ] as const),
  Object.freeze([
    'only-inside-the-document-a-host',
    Object.freeze({
      channel: CHANNEL_CUES,
      exclusivity: Object.freeze([
        'only inside the document a host',
        'only inside the HTML a host',
      ]),
    }),
  ] as const),
])

/** The date every 2026-09-01 gap-round supersession in this repository is stamped with. */
const SUPERSESSION_DATE = '2026-09-01'

/**
 * The strike vocabulary, seeded from the four sites 408-08 already corrected in place:
 * `app-resource.ts` :11-22 ("corrected") and clause 3 ("SUPERSEDED IN PART"), `mapping.ts`'s header
 * and reason literal ("RE-GROUNDED"), `scenario-table.ts`'s class disposition ("DISPOSITION").
 * Matched case-insensitively, and a unit is `struck` only when it carries BOTH the date and one of
 * these in its OWN prose unit — a marker written into a neighbouring unit strikes nothing.
 */
const STRIKE_MARKERS: readonly string[] = Object.freeze([
  'SUPERSEDED',
  'WITHDRAWN',
  'RE-GROUNDED',
  'corrected',
  'DISPOSITION',
  'over-claim',
])

interface SweptFile {
  readonly path: string
  readonly rel: string
  readonly text: string
}

interface ProseUnit {
  readonly rel: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

type OccurrenceDisposition = 'asserted' | 'struck'

interface ClaimOccurrence {
  readonly rel: string
  readonly startLine: number
  readonly endLine: number
  readonly signature: string
  readonly disposition: OccurrenceDisposition
  readonly text: string
}

/**
 * Every `.ts` file under every `SWEEP_ROOTS` entry, produced by walking, never typed out.
 *
 * `node_modules` and `dist` are skipped: build outputs are not shipped source, and `dist` carries
 * `.d.ts` files that would match `.ts` and double-count every module in the denominator.
 */
function sweptProseFiles(): readonly SweptFile[] {
  const out: SweptFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      if (CENSUS_SELF_EXCLUSION.includes(full)) continue
      out.push({ path: full, rel: relative(PACKAGES_ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }
  for (const root of SWEEP_ROOTS) walk(root)
  return [...out].sort((a: SweptFile, b: SweptFile) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** A source line whose content is a comment, in either idiom this repository uses. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/**
 * A line that OPENS a new enumerated item — rule (d), and the one structural decision this whole
 * gate turns on.
 *
 * Matched STRUCTURALLY (an optional comment marker, then `N.` or `(x)`, then whitespace) and never
 * by a line count or a character count: `ext-apps-constants.test.ts` bounds its handshake block by
 * its own closing `postMessage` for the same reason, and 408-12's truth 5 is that a census bounded
 * by a magic count is not a census.
 */
function opensEnumeratedItem(line: string): boolean {
  const body = line.replace(/^\s*(\/\/+|\/\*+|\*+)\s*/, '')
  return /^(\d{1,3}\.|\([0-9a-zA-Z]{1,3}\))\s/.test(body)
}

/** Comment markers stripped, whitespace collapsed, so a claim wrapped across lines is one string. */
function normalizeProse(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\/+|\/\*+|\*+\/|\*+)\s?/, ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * The span of prose a reader meets as ONE thing.
 *
 * Cuts at (a) a blank source line; (c) a transition between comment lines and non-comment lines in
 * either direction; and (d) a line that opens a new enumerated item. Rule (d) is the decision:
 * `app-resource.ts`'s header is one contiguous comment run from :1 to past :130, so without it
 * clause 1 at :37 and clause 3's "SUPERSEDED IN PART, 2026-09-01" marker at :51 fall in the same
 * unit and the census would classify the very defect that produced this gap round as already
 * struck. `(W2)` is the standing control on exactly that.
 *
 * Rule (b) of the plan — cutting at a blank COMMENT line — is deliberately not implemented; see the
 * file header for why, and for the two already-reconciled sites it would falsely red.
 */
function proseUnitsOf(text: string, rel: string): readonly ProseUnit[] {
  const lines = text.split('\n')
  const units: ProseUnit[] = []
  let startIdx = -1
  let prevKind: 'comment' | 'code' | null = null

  const flush = (endIdx: number): void => {
    if (startIdx === -1 || endIdx < startIdx) return
    const raw = lines.slice(startIdx, endIdx + 1).join('\n')
    const normalized = normalizeProse(raw)
    if (normalized !== '') {
      units.push({ rel, startLine: startIdx + 1, endLine: endIdx + 1, text: normalized })
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      flush(i - 1)
      startIdx = -1
      prevKind = null
      continue
    }
    const kind: 'comment' | 'code' = isCommentLine(line) ? 'comment' : 'code'
    if (prevKind !== null && kind !== prevKind) {
      flush(i - 1)
      startIdx = -1
    }
    if (startIdx !== -1 && opensEnumeratedItem(line)) {
      flush(i - 1)
      startIdx = -1
    }
    if (startIdx === -1) startIdx = i
    prevKind = kind
  }
  flush(lines.length - 1)
  return units
}

/** The signature a unit matches, first-hit-wins over the declared order, or `undefined` for none. */
function claimSignatureOf(text: string): string | undefined {
  const haystack = text.toLowerCase()
  for (const [key, cues] of WITHDRAWN_CLAIM_SIGNATURES) {
    const hasChannel = cues.channel.some((cue) => haystack.includes(cue.toLowerCase()))
    if (!hasChannel) continue
    const hasExclusivity = cues.exclusivity.some((cue) => haystack.includes(cue.toLowerCase()))
    if (hasExclusivity) return key
  }
  return undefined
}

/** `struck` only when the claim's OWN unit carries the date AND a strike word. */
function classifyOccurrence(unit: ProseUnit): OccurrenceDisposition {
  if (!unit.text.includes(SUPERSESSION_DATE)) return 'asserted'
  const haystack = unit.text.toLowerCase()
  const struck = STRIKE_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()))
  return struck ? 'struck' : 'asserted'
}

/** Every unit of one file that restates the withdrawn claim, classified. */
function claimOccurrencesIn(file: SweptFile): readonly ClaimOccurrence[] {
  const out: ClaimOccurrence[] = []
  for (const unit of proseUnitsOf(file.text, file.rel)) {
    const signature = claimSignatureOf(unit.text)
    if (signature === undefined) continue
    out.push({
      rel: unit.rel,
      startLine: unit.startLine,
      endLine: unit.endLine,
      signature,
      disposition: classifyOccurrence(unit),
      text: unit.text,
    })
  }
  return out
}

function allClaimOccurrences(): readonly ClaimOccurrence[] {
  return sweptProseFiles().flatMap((file) => claimOccurrencesIn(file))
}

interface KnownClaimSite {
  readonly rel: string
  readonly anchor: string
}

/**
 * Every occurrence site the sweep is expected to produce, WRITTEN OUT rather than derived from it.
 *
 * Deriving the register from the sweep would make it true by construction — the exact defect
 * `FLOW_CHANNELS`' comment in `token-absence.test.ts` names ("Composing it would make the partition
 * true by construction and the classification unfalsifiable"). Written out, `(W4)` can answer in
 * BOTH directions.
 *
 * There are EIGHT sites across FIVE files. Do not conflate that eight with the eight FILES the
 * channel vocabulary appears in at all — that is a different measurement, innocent uses included,
 * and today it is exactly `app-resource.ts`, `app-wrapper.ts`, `mapping.ts`, `app-negotiation.test.ts`,
 * `app-resource.test.ts`, `token-absence.test.ts`, `scenario-table.ts`, `parity.test.ts`.
 *
 * A REGISTER ENTRY THE SWEEP NO LONGER FINDS IS A FINDING, NOT A CLEANUP. A struck quote that was
 * silently deleted is the "edited away" failure this repository's own law forbids, so `(W4)` reds on
 * it rather than letting the census shrink quietly.
 */
const KNOWN_CLAIM_SITES: readonly KnownClaimSite[] = Object.freeze([
  Object.freeze({
    rel: 'mcp/src/app-resource.ts',
    anchor: 'the token lands only in the HTML the HOST renders',
  }),
  Object.freeze({
    rel: 'mcp/src/app-resource.ts',
    anchor: 'THE TOKEN CHANNEL IS HOST-RENDERED HTML',
  }),
  Object.freeze({
    rel: 'mcp/src/mapping.ts',
    anchor: 'the token reaches a person only through host-rendered HTML',
  }),
  Object.freeze({
    rel: 'mcp/src/mapping.ts',
    anchor: 'the minted token lands only in the',
  }),
  Object.freeze({
    rel: 'cli/src/__tests__/conformance/scenario-table.ts',
    anchor: 'the token reaches a person only in host-rendered HTML',
  }),
  Object.freeze({
    rel: 'cli/src/__tests__/conformance/scenario-table.ts',
    anchor: 'the minted token lands in host-rendered HTML',
  }),
  Object.freeze({
    rel: 'cli/src/__tests__/conformance/parity.test.ts',
    anchor: 'the token confined to host-rendered App HTML',
  }),
  Object.freeze({
    rel: 'mcp/src/__tests__/token-absence.test.ts',
    anchor: 'reaches a person only inside the HTML a host paints',
  }),
])

/**
 * THE RECALL CORPUS — the four gap texts, quoted verbatim from the sites as they read at the start
 * of 408-15, each with its `rel`.
 *
 * These stay here after the sites are corrected. A signature list that stopped matching the prose it
 * was built from has silently stopped working, and nothing else in this file would notice.
 */
const ASSERTING_PROSE_FIXTURES: readonly { readonly rel: string; readonly text: string }[] =
  Object.freeze([
    Object.freeze({
      rel: 'mcp/src/app-resource.ts',
      text:
        '1. THE TOKEN CHANNEL IS HOST-RENDERED HTML (D-01). A minted `liveUrl` reaches a person only '
        + 'inside the document a host paints in its sandbox. It is never tool-result text, never a '
        + 'refusal echo, and never a listing.',
    }),
    Object.freeze({
      rel: 'cli/src/__tests__/conformance/scenario-table.ts',
      text:
        'RESOLVED 2026-08-31 (408 D-01): the question is answered and the row does not move. Internal '
        + 'mint ONLY — the MCP server invokes this op by reference inside its `ui://agent-qa/live-run/` '
        + 'App resource read (408 plans 01/03), so the minted token lands in host-rendered HTML and '
        + 'never in tool-result text; a projected mint tool stays rejected.',
    }),
    Object.freeze({
      rel: 'cli/src/__tests__/conformance/parity.test.ts',
      text:
        '408 D-01 answered it — internal mint only, the token confined to host-rendered App HTML, a '
        + 'projected mint tool rejected — and D-14 requires that answer RECORDED rather than silently '
        + 'absorbed.',
    }),
    Object.freeze({
      rel: 'mcp/src/__tests__/token-absence.test.ts',
      text:
        "WHY THIS FILE EXISTS. D-01 splits the phase's credential by CHANNEL: a minted `liveUrl` token "
        + 'reaches a person only inside the HTML a host paints in its sandbox, and never inside '
        + 'anything a MODEL reads — not tool-result text, not `structuredContent`, not a listing, not '
        + 'a refusal echo, not a log line.',
    }),
  ])

/**
 * THE PRECISION CORPUS — the six measured descriptive uses of the same vocabulary, quoted verbatim.
 *
 * An over-broad signature reds HERE rather than shipping. That matters more than it sounds: a gate
 * that reds on the honest prose it exists to protect trains a reader to disable it, which is worse
 * than no gate at all (T-408-30).
 */
const INNOCENT_PROSE_FIXTURES: readonly { readonly where: string; readonly text: string }[] =
  Object.freeze([
    Object.freeze({
      where: 'mcp/src/app-wrapper.ts:3',
      text:
        'WHAT THIS DOCUMENT IS. A thin host-rendered page that IFRAMES the `liveUrl` Phase 403 already '
        + 'mints and serves. It is not a second embed document.',
    }),
    Object.freeze({
      where: 'mcp/src/__tests__/app-negotiation.test.ts:392',
      text:
        'The tokens are IN the bytes the host renders — read back out of the document rather than out '
        + 'of the input the renderer was handed — and each one goes past the SHIPPED validator.',
    }),
    Object.freeze({
      where: 'mcp/src/__tests__/app-resource.test.ts:279',
      text:
        'Deliberately a scan over the whole document rather than a lookup into a structure — the claim '
        + 'is that the tokens are IN the bytes the host renders, and reading them back out of the '
        + 'input the renderer was handed would assert nothing about the output.',
    }),
    Object.freeze({
      where: 'mcp/src/__tests__/token-absence.test.ts:38',
      text:
        "That channel is the credential's DESTINATION, not a leak: it is the host-rendered payload "
        + 'clause 1 of the four-clause `ui://` read-channel adjudication in `../app-resource.ts`.',
    }),
    Object.freeze({
      where: 'mcp/src/__tests__/token-absence.test.ts:440',
      text: 'The ONE excluded channel: the host-rendered wrapper document.',
    }),
    Object.freeze({
      where: 'mcp/src/__tests__/token-absence.test.ts:660',
      text: 'the host-rendered wrapper does not carry the token it exists to deliver',
    }),
  ])

// ---- The law ------------------------------------------------------------------------------------

describe('the withdrawn host-rendered-channel claim survives nowhere in shipped prose (408-08 truth 4, host-rendered half)', () => {
  it('(W0) CONTROL: the sweep resolves the workspace packages root, and the exclusion is exactly one path', () => {
    const files = sweptProseFiles()

    // The printed line is LOAD-BEARING and is not debug output to be tidied away: it is what lets a
    // shell gate floor the census's OWN resolved denominator instead of counting `git ls-files`,
    // which measures the repository and would stay green through a mis-resolved root.
    //
    // WRITTEN TO `process.stdout` RATHER THAN THROUGH `console.log`, AND THE REASON IS THE GATE.
    // 408-15-PLAN.md says `console.log`; measured 2026-09-01 against the shipped vitest 4.1.5, the
    // default reporter INTERCEPTS `console.log` and discards it whenever stdout is not a TTY — which
    // is exactly the condition every shell gate runs under. A line the gate cannot read is not an
    // observable denominator, so the write goes to the stream directly. It is still one line, still
    // once, and `--reporter=default` shows it attributed to this cell.
    process.stdout.write(`CENSUS-SWEPT-FILES=${files.length}\n`)

    // A sweep over zero files passes every assertion below it, and a sweep over the wrong
    // thirty-three passes them just as silently. Measured today: 2208 (2207 tracked plus one
    // gitignored local file, `analytics/src/posthog-project.ts`). The same walk rooted one level too
    // deep at `packages/mcp/` yields 33, and at `packages/mcp/src/__tests__/` fewer still.
    expect(
      files.length,
      'the census swept fewer files than the workspace holds — its root resolved somewhere other '
      + `than ${PACKAGES_ROOT}, and every absence (W3) reports below is vacuous`,
    ).toBeGreaterThanOrEqual(1500)
    expect(SWEEP_ROOTS.length, 'no packages/*/src root resolved at all').toBeGreaterThan(0)
    expect(files.every((f) => f.rel.endsWith('.ts'))).toBe(true)

    // Named individually, so a site that fell out of the surface reds HERE by name rather than
    // quietly leaving (W3) nothing to find.
    const rels = new Set(files.map((f) => f.rel))
    for (const site of KNOWN_CLAIM_SITES) {
      expect(rels.has(site.rel), `the sweep no longer reaches ${site.rel} — the surface shrank`)
        .toBe(true)
    }

    expect(
      CENSUS_SELF_EXCLUSION.length,
      'the self-exclusion grew past one path — an exclusion list that can grow is a whitelist, and '
      + 'a second entry is a FINDING to record, not a line to add',
    ).toBe(1)
    expect(CENSUS_SELF_EXCLUSION[0], 'the one excluded path is this file, by identity').toBe(THIS_FILE)
    expect(files.some((f) => f.path === THIS_FILE), 'this file must not sweep itself').toBe(false)
  })

  it('(W1) CONTROL: the signature vocabulary has recall over the measured claims and precision over honest prose', () => {
    for (const fixture of ASSERTING_PROSE_FIXTURES) {
      expect(
        claimSignatureOf(fixture.text),
        `RECALL LOST at ${fixture.rel}: the vocabulary no longer matches the prose it was built `
        + 'from, so this census has silently stopped watching that site',
      ).toBeDefined()
    }

    for (const fixture of INNOCENT_PROSE_FIXTURES) {
      expect(
        claimSignatureOf(fixture.text),
        `PRECISION LOST at ${fixture.where}: the vocabulary now reds on an honest DESCRIPTION of the `
        + 'wrapper document. An over-broad gate trains a reader to disable it, which is worse than '
        + 'no gate — narrow the exclusivity cue rather than the corpus',
      ).toBeUndefined()
    }

    // And the PAIR is load-bearing rather than decorative: a channel cue alone is a fact, an
    // exclusivity cue alone is about something else, and only the two together are the over-claim.
    expect(claimSignatureOf('a thin host-rendered page that iframes the liveUrl')).toBeUndefined()
    expect(claimSignatureOf('the artifact reaches a person only through the dashboard')).toBeUndefined()
    expect(
      claimSignatureOf('the minted token reaches a person only through host-rendered HTML'),
    ).toBeDefined()
  })

  it('(W2) CONTROL: the segmenter subdivides an enumerated ruling at its own item openers', () => {
    const appResource = readFileSync(join(PACKAGES_ROOT, 'mcp/src/app-resource.ts'), 'utf8')
    const lines = appResource.split('\n')
    const clauseOneLine = lines.findIndex((l) => l.includes('THE TOKEN CHANNEL IS HOST-RENDERED HTML')) + 1
    const clauseThreeMarkerLine =
      lines.findIndex((l) => l.includes(`SUPERSEDED IN PART, ${SUPERSESSION_DATE}`)) + 1

    expect(clauseOneLine, 'app-resource.ts clause 1 is gone — re-anchor this control').toBeGreaterThan(0)
    expect(clauseThreeMarkerLine, 'app-resource.ts clause 3 lost its marker').toBeGreaterThan(0)

    const units = proseUnitsOf(appResource, 'mcp/src/app-resource.ts')
    const unitOf = (line: number): ProseUnit | undefined =>
      units.find((u) => u.startLine <= line && line <= u.endLine)

    const one = unitOf(clauseOneLine)
    const three = unitOf(clauseThreeMarkerLine)
    expect(one, 'clause 1 fell into no unit at all').toBeDefined()
    expect(three, "clause 3's marker fell into no unit at all").toBeDefined()
    expect(
      one?.startLine === three?.startLine,
      'the segmenter COARSENED: clause 1 and clause 3 now share a unit, so clause 3 marker would '
      + 'silently strike clause 1 and (W3) would pass vacuously — which is exactly how this truth '
      + 'passed the first time',
    ).toBe(false)

    // And the marker really is in clause 3's unit rather than merely elsewhere in the file, so the
    // subdivision is measured in both directions.
    expect(three?.text.includes(SUPERSESSION_DATE)).toBe(true)
    expect(one?.text.includes(SUPERSESSION_DATE)).toBe(false)
  })

  it('(W3) THE LAW: no unit of shipped prose asserts the withdrawn claim without its own dated supersession', () => {
    const asserted = allClaimOccurrences().filter((o) => o.disposition === 'asserted')
    const report = asserted
      .map((o) => `  ${o.rel}:${o.startLine}  [${o.signature}]  ${o.text.slice(0, 200)}`)
      .join('\n')

    expect(
      asserted.map((o) => `${o.rel}:${o.startLine}`),
      'shipped prose restates the WITHDRAWN host-rendered-channel claim with no dated '
      + `${SUPERSESSION_DATE} supersession marker in its OWN prose unit. Strike each site in place — `
      + 'quote it and mark it, never reword it away - in the idiom app-resource.ts:11-22 and clause 3 '
      + `already ship:\n${report}\n`,
    ).toEqual([])
  })

  it('(W4) CONTROL: the register and the sweep agree, in both directions', () => {
    const occurrences = allClaimOccurrences()
    const matches = (site: KnownClaimSite, occ: ClaimOccurrence): boolean =>
      occ.rel === site.rel && occ.text.toLowerCase().includes(site.anchor.toLowerCase())

    // Forward: a site the register names that the sweep no longer produces. A struck quote that was
    // silently deleted is the "edited away" failure this repository's law forbids — it is a FINDING,
    // and the census reds on it rather than shrinking quietly.
    const vanished = KNOWN_CLAIM_SITES.filter(
      (site) => !occurrences.some((occ) => matches(site, occ)),
    ).map((site) => `${site.rel} :: ${site.anchor}`)
    expect(
      vanished,
      'a registered occurrence is no longer produced by the sweep. If the quote was deleted rather '
      + 'than struck in place, that is the defect — restore it and mark it. If it was legitimately '
      + 'reworded, retire the register entry in the same commit and say so.',
    ).toEqual([])

    // Reverse: a site the sweep produced that nobody registered. This is what stops the register
    // drifting behind the prose, and it is the direction (A2) in token-absence.test.ts exists for.
    const unregistered = occurrences
      .filter((occ) => !KNOWN_CLAIM_SITES.some((site) => matches(site, occ)))
      .map((occ) => `${occ.rel}:${occ.startLine} [${occ.signature}] ${occ.text.slice(0, 160)}`)
    expect(
      unregistered,
      'the sweep found a restatement of the withdrawn claim that KNOWN_CLAIM_SITES does not name — '
      + 'register it and classify it honestly rather than tuning the vocabulary until the count '
      + 'matches',
    ).toEqual([])

    expect(KNOWN_CLAIM_SITES.length, 'the register emptied — (W3) would then be vacuous').toBe(8)
  })
})
