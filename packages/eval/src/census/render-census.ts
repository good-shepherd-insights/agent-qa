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

import type { AdversarialGenerationMix, CensusCrossCheckLine, CorpusCensus } from './derive-census'

/** The bullet body of a counter group, sorted — honest '- none' when empty (D-04). */
function counterBullets(counts: Readonly<Record<string, number>>): string[] {
  const keys = Object.keys(counts).sort()
  if (keys.length === 0) return ['- none']
  return keys.map(key => `- ${key}: ${counts[key]}`)
}

/**
 * A counter group under a heading spelled IN FULL at the call site. The 414 sections below use
 * this form so the locked heading text is greppable in this file's raw source, not assembled from
 * a fragment at render time.
 */
function countedSection(heading: string, counts: Readonly<Record<string, number>>): string[] {
  return [heading, '', ...counterBullets(counts), '']
}

/** Sorted-key counter group as markdown bullets — honest '- none' when empty (D-04). */
function counterLines(title: string, counts: Readonly<Record<string, number>>): string[] {
  return countedSection(`### ${title}`, counts)
}

function rateLine(
  name: string,
  metric: { numerator: number; denominator: number; rate?: number },
): string {
  const rate = metric.rate === undefined ? 'n/a (zero denominator)' : `${metric.rate}`
  return `- ${name}: ${metric.numerator}/${metric.denominator} (rate: ${rate})`
}

/**
 * 422 D-05/D-08/D-11: the committed generation mix, printed so the reader can see the three
 * separations the DTO makes rather than having to reconstruct them.
 *
 * The heading is spelled IN FULL here so it is greppable in this file's raw source. An open-set
 * group with no observed value prints '- none' — which is the honest statement "no member named
 * one", distinct from the closed-set groups below it where every declared member prints its own
 * count including zero.
 */
function generationMixLines(mix: AdversarialGenerationMix): string[] {
  const lines = ['### Adversarial generation mix', '']
  lines.push(`- total: ${mix.total}`)
  lines.push(`- metadataUnavailable: ${mix.metadataUnavailable}`)
  lines.push('')
  lines.push(...counterLines('Generation mix by provenance', mix.byProvenance))
  lines.push(...counterLines('Generation mix by kind', mix.byKind))
  lines.push(...counterLines('Generation mix by mutator', mix.byMutator))
  lines.push('### Generation mix by table version', '')
  const versions = Object.keys(mix.byTableVersion).sort()
  if (versions.length === 0) {
    lines.push('- none')
  } else {
    for (const version of versions) lines.push(`- v${version}: ${mix.byTableVersion[version]}`)
  }
  lines.push('')
  // One generation is supposed to name exactly one frozen table; two spellings under one version
  // is the tamper signal, so the hashes print rather than collapsing into the count above.
  lines.push('- tableHashesByVersion:')
  const hashed = Object.keys(mix.tableHashesByVersion).sort()
  if (hashed.length === 0) {
    lines.push('  - none')
  } else {
    for (const version of hashed) {
      lines.push(`  - v${version}: ${[...mix.tableHashesByVersion[version]!].join(', ')}`)
    }
  }
  lines.push('')
  lines.push(...counterLines('Generation mix by prompt version', mix.byPromptVersion))
  lines.push(...counterLines('Generation mix by authoring model', mix.byAuthoringModel))
  lines.push(...counterLines('Generation mix by authoring family', mix.byAuthoringFamily))
  return lines
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
  // 414 D-17: which entry schema versions the committed BYTES still declare. Every entry is the
  // v2 shape in memory, so this sub-list is the only place a reader learns a v1 file is still on
  // disk. Sorted keys; '- none' when the read leg admitted no entry at all.
  lines.push('- schemaVersionsSeen:')
  const versionKeys = Object.keys(census.schemaVersionsSeen).sort()
  if (versionKeys.length === 0) {
    lines.push('  - none')
  } else {
    for (const key of versionKeys) lines.push(`  - v${key}: ${census.schemaVersionsSeen[key]}`)
  }
  lines.push('')

  // 414 D-17: the committed partition parameters, per PARTITIONED product, immediately after
  // Provenance — they name how every split below was decided. The salt itself is a partition
  // secret (a public salt lets a proposer compute the held-out set for itself), so only its
  // digest is printed; an unpartitioned root says '- none' rather than inventing a row.
  lines.push('## Partition', '')
  const partitionKeys = Object.keys(census.partition).sort()
  if (partitionKeys.length === 0) {
    lines.push('- none')
  } else {
    for (const product of partitionKeys) {
      const block = census.partition[product]!
      lines.push(
        `- ${product}: saltDigest=${block.saltDigest} `
          + `heldOutFraction=${block.heldOutFraction} privateFraction=${block.privateFraction} `
          + `partitionVersion=${block.partitionVersion}`,
      )
    }
  }
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
    if (block.labelAudit !== undefined) {
      lines.push(...counterLines('labelAudit', block.labelAudit))
    }
    if (block.markedGold !== undefined) {
      lines.push(`- marked gold: user-mark ${block.markedGold['user-mark']} · overturned-verdict ${block.markedGold['overturned-verdict']}`, '')
    }
    lines.push(...counterLines('rungMix', block.rungMix))
    lines.push(...counterLines('briefContent', block.briefContent))
    lines.push(...counterLines('runsExcluded', block.runsExcluded))
    lines.push(...counterLines('runsExcludedByProducer', block.runsExcludedByProducer))
    lines.push(...counterLines('seededByProducer', block.seededByProducer))
    lines.push(...counterLines('repeatCounts', block.repeatCounts))

    // 414 D-17. Splits: the four split x visibility arms as raw integers. Field coverage: how
    // many entries carry each OPTIONAL D-04 field, as numerator/denominator. Exclusions: what the
    // committed exclusions/** records say. Counts and pairs only — D-16 stands, and Phase 415 is
    // where a number becomes a claim.
    // Spread rather than passed straight through: `GateSetCounts` is an interface, and an
    // interface carries no implicit index signature, so the anonymous spread is what makes the
    // shared counter group typecheck. A fifth arm joining the type still flows through unchanged.
    const splits: Readonly<Record<string, number>> = { ...block.splits }
    lines.push(...countedSection('### Splits', splits))
    lines.push('### Field coverage', '')
    lines.push(rateLine('capturedAt', block.fieldCoverage.capturedAt))
    lines.push(rateLine('targetEnvironment', block.fieldCoverage.targetEnvironment))
    lines.push('')
    lines.push('### Exclusions', '')
    lines.push(`- total: ${block.exclusions.total}`)
    lines.push('')
    lines.push(...counterLines('By class', block.exclusions.byClass))
    lines.push(...counterLines('By producer', block.exclusions.byProducer))

    // 422 D-05/D-08: absent when the product holds no committed adversarial member. Nothing is
    // printed rather than a section of zeros, for the same reason the DTO omits the block.
    if (block.adversarialGenerationMix !== undefined) {
      lines.push(...generationMixLines(block.adversarialGenerationMix))
    }
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
