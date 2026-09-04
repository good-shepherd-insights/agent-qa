// The deterministic markdown projection of CorpusCensus (Phase 413 D-15/D-16) — the sibling of
// eval-report-render.ts, same contract, different DTO. A pure template over the census: every
// number lands verbatim, object keys iterate in sorted order, and no clock reading or locale
// formatting can enter the output. That byte-determinism is what makes the write-once
// re-commit byte-compare in commitCensus meaningful (D-15): re-deriving the census over an
// unchanged corpus must produce the identical string so the second `--commit` reports
// 'unchanged' rather than a write-conflict.
//
// D-16 FORBIDS INTERPRETATION. This file publishes counts, coverage and tallies and stops. No
// threshold, no minimum-n constant, no "n below N makes no claim" line, no per-stratum accuracy
// claim, no percentage. Phase 415 decides what an n supports; a census that editorialises has
// already decided it. The only numeric constant here is the schemaVersion the DTO carries.
//
// D-04 never-silent: an empty counter group prints '- none' rather than vanishing, and an absent
// campaign prints '- none supplied' rather than a row of zeros that reads like a campaign that
// measured nothing.

// FUNC-02 surface firewall (384 D-01/D-03): the census DTO types arrive through the ledgered
// composition root beside this file, never through a second direct edge to `@vostride/agent-qa-eval`
// — the ledger only shrinks, and a file written now may not join it. Type-only, erased at build,
// so the value edge stays one-way (composition imports this renderer, not the reverse).
import type { CensusCrossCheckLine, CorpusCensus } from './eval-session-composition.js'

/** Sorted-key counter group as markdown bullets — honest '- none' when empty (D-04). */
function counterLines(title: string, counts: Readonly<Record<string, number>>): string[] {
  const lines = [`### ${title}`, '']
  const keys = Object.keys(counts).sort()
  if (keys.length === 0) {
    lines.push('- none')
  } else {
    for (const key of keys) lines.push(`- ${key}: ${counts[key]}`)
  }
  lines.push('')
  return lines
}

function rateLine(
  name: string,
  metric: { numerator: number; denominator: number; rate?: number },
): string {
  const rate = metric.rate === undefined ? 'n/a (zero denominator)' : `${metric.rate}`
  return `- ${name}: ${metric.numerator}/${metric.denominator} (rate: ${rate})`
}

/** One cross-check line: the two populations printed side by side, never reconciled (F7). */
function crossCheckLines(line: CensusCrossCheckLine): string[] {
  const comparator =
    line.comparator.ok
      ? 'ok'
      : `refused:${line.comparator.refusal.kind}`
  const designatedBy = line.designatedBy.length === 0 ? 'none' : [...line.designatedBy].sort().join(',')
  return [
    `- ${line.batchKey}: decisions=${line.decisionCount} `
      + `corpusCassettes=${line.corpusCassetteCount} `
      + `membershipComparable=${line.membershipComparable} `
      + `comparator=${comparator} designatedBy=${designatedBy}`,
  ]
}

/**
 * Render one CorpusCensus DTO to its committed markdown projection. Locked structure (D-15):
 * H1 + Provenance, one H2 per product in sorted key order, Campaign, Cross-check. Every value is
 * projected verbatim from the DTO — the renderer never sums, rates, or re-derives anything.
 */
export function renderCensusMarkdown(census: CorpusCensus): string {
  const lines: string[] = ['# Corpus Census', '']

  // Provenance: the digest that NAMES this census's corpus, the membership size, the version.
  lines.push('## Provenance', '')
  lines.push(`- corpusDigest: ${census.corpusDigest}`)
  lines.push(`- entryCount: ${census.entryCount}`)
  lines.push(`- schemaVersion: ${census.schemaVersion}`)
  lines.push('')

  // One section per product, sorted — the D-16 triple first, then every counter group.
  for (const product of Object.keys(census.products).sort()) {
    const block = census.products[product]!
    lines.push(`## ${product}`, '')
    lines.push(`- total: ${block.total}`)
    lines.push(
      `- scorableByTier: tier1=${block.scorableByTier.tier1} `
        + `tier2=${block.scorableByTier.tier2} tier3=${block.scorableByTier.tier3}`,
    )
    lines.push(`- goldEvidence: ${block.goldEvidence}`)
    lines.push(rateLine('proofCoverage', block.proofCoverage))
    lines.push(rateLine('blobsPresentLocally', block.blobsPresentLocally))
    lines.push(`- missingLabelRecord: ${block.missingLabelRecord}`)
    lines.push(`- missingCassette: ${block.missingCassette}`)
    lines.push(`- runsSeeded: ${block.runsSeeded}`)
    lines.push('')
    lines.push(...counterLines('staticScorability', block.staticScorability))
    lines.push(...counterLines('labelTiers', block.labelTiers))
    lines.push(...counterLines('rungMix', block.rungMix))
    lines.push(...counterLines('briefContent', block.briefContent))
    lines.push(...counterLines('runsExcluded', block.runsExcluded))
    lines.push(...counterLines('runsExcludedByProducer', block.runsExcludedByProducer))
    lines.push(...counterLines('seededByProducer', block.seededByProducer))
    lines.push(...counterLines('repeatCounts', block.repeatCounts))
  }

  // Campaign: an absent manifest states its absence rather than printing zeros (D-04).
  lines.push('## Campaign', '')
  const campaign = census.campaign
  if (!campaign.present) {
    lines.push('- none supplied')
  } else {
    lines.push(`- manifestDigest: ${campaign.manifestDigest}`)
    lines.push(`- legs: ${campaign.legs}`)
    lines.push(`- runsSeeded: ${campaign.runsSeeded}`)
    lines.push(`- runsExcluded: ${campaign.runsExcluded}`)
    lines.push(`- modelCalls: ${campaign.modelCalls}`)
    lines.push(`- promptTokens: ${campaign.promptTokens}`)
    lines.push(`- completionTokens: ${campaign.completionTokens}`)
    lines.push(`- wallClockMs: ${campaign.wallClockMs}`)
  }
  lines.push('')

  // Cross-check: one line per committed report, then its two honesty counter groups. The
  // comparator verdict is the DTO's, computed by the caller through the ONE predicate (D-20).
  lines.push('## Cross-check', '')
  if (census.crossCheck.length === 0) {
    lines.push('- none')
    lines.push('')
  } else {
    for (const line of census.crossCheck) lines.push(...crossCheckLines(line))
    lines.push('')
    for (const line of census.crossCheck) {
      lines.push(...counterLines(`${line.batchKey} unscorableIdentityCounts`, line.unscorableIdentityCounts))
      lines.push(...counterLines(`${line.batchKey} refusalCounts`, line.refusalCounts))
    }
  }

  return lines.join('\n')
}
