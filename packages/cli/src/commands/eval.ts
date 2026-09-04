// The `agent-qa eval` command family (Phase 372, D-01): the CLI face of the offline eval
// substrate. 372-05 landed the family skeleton plus `extract`; 372-06 adds `replay`; seed/
// report join in 372-07 against this shape — no stub subcommands. The command layer is a thin
// projection: it resolves the session, calls the ONE verb pipeline in eval-session-composition,
// and renders FROM the returned DTO (D-04) — `--json` emits exactly the DTO on stdout with
// nothing else (Pitfall 11). Errors map to `process.exitCode = 1` (D-08), never `process.exit`.

import { Command, InvalidArgumentError } from 'commander'
import pc from 'picocolors'
import type {
  CensusVerbResult,
  ExtractVerbResult,
  ReplayVerbResult,
  ReportVerbResult,
  SeedVerbResult,
} from '../eval-session-composition.js'

// The auth.ts parent-opts idiom: the global `--config` lives on the program two levels above a
// nested subcommand (program > eval > extract).
function getGlobalConfigPath(command: Command): string | undefined {
  return command.parent?.parent?.opts<{ config?: string }>().config
    ?? command.parent?.opts<{ config?: string }>().config
}

/** Typed integer flag parser (D-08): a non-integer `--k`/`--seed` is a loud invalid-value error. */
function parseIntegerFlag(flagName: string): (value: string) => number {
  return (value: string): number => {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new InvalidArgumentError(`${flagName} must be an integer, got "${value}".`)
    }
    return Number.parseInt(value.trim(), 10)
  }
}

/** Render a Record counter as `reason=count …`, honest 'none' when empty (D-04). */
function renderCounters(counters: Record<string, number>): string {
  const rendered = Object.entries(counters)
    .map(([name, count]) => `${name}=${count}`)
    .join(' ')
  return rendered === '' ? pc.dim('none') : rendered
}

/** Compact replay summary rendered from the DTO fields only — a faithful projection (D-04). */
function renderReplaySummary(result: ReplayVerbResult): void {
  console.log(
    pc.bold(`replay: batch ${result.batchKey}`)
      + pc.dim(` (swept ${result.swept}, replayed ${result.replayed}, scored ${result.scored})`),
  )
  console.log(`load refusals: ${renderCounters(result.loadRefusals)}`)
  console.log(`replay refusals: ${renderCounters(result.replayRefusals)}`)
  const judge = result.judge
  const zeroTies =
    judge.invoked === 0
    && judge.settled === 0
    && judge.abstained === 0
    && judge.errors === 0
    && judge.notInvoked === 0
  console.log(
    `judge: ${judge.configured ? 'configured' : 'not configured'} — `
      + `${judge.invoked} invoked, ${judge.settled} settled, ${judge.abstained} abstained, `
      + `${judge.errors} errors, ${judge.notInvoked} not-invoked`
      + (zeroTies ? pc.dim(' (0 ties)') : ''),
  )
  for (const notice of result.notices) {
    console.log(pc.dim(notice))
  }
  console.log(pc.dim(`replays root: ${result.replaysRoot}`))
}

/** Compact seed summary rendered from the DTO fields only — a faithful projection (D-04). */
function renderSeedSummary(result: SeedVerbResult): void {
  console.log(
    pc.bold(`seed: ${result.handoffsSeeded} handoff(s) seeded`)
      + pc.dim(
        ` (swept ${result.runsSwept}, ${result.runsSkipped.length} skipped, `
          + `${result.runsFiltered} filtered)`,
      ),
  )
  for (const skip of result.runsSkipped) {
    console.log(pc.yellow(`  skipped ${skip.runSlug}: ${skip.reason}`))
  }
  // 413 D-04: an excluded run is COUNTED and named with the verdicts that excluded it, and every
  // admitted run discloses the producer it was admitted under — never a silent filter.
  const excludedByClass: Record<string, number> = {}
  for (const excluded of result.runsExcluded) {
    for (const verdict of excluded.verdicts) {
      excludedByClass[verdict.class] = (excludedByClass[verdict.class] ?? 0) + 1
    }
  }
  console.log(
    `excluded: ${result.runsExcluded.length} (${renderCounters(excludedByClass)}), `
      + `admitted: ${result.runsAdmitted.length}`,
  )
  for (const excluded of result.runsExcluded) {
    console.log(
      pc.dim(
        `  excluded ${excluded.runSlug} [${excluded.product}]: `
          + excluded.verdicts.map(verdict => `${verdict.class}/${verdict.producer}`).join(' '),
      ),
    )
  }
  for (const notice of result.notices) {
    console.log(pc.dim(notice))
  }
  console.log(`cases: ${result.seededCount} seeded, ${result.unchangedCount} unchanged`)
  const refusalsByKind: Record<string, number> = {}
  for (const refusal of result.refusals) {
    refusalsByKind[refusal.kind] = (refusalsByKind[refusal.kind] ?? 0) + 1
  }
  console.log(`refusals: ${renderCounters(refusalsByKind)}`)
  console.log(
    `pairs: ${result.pairCounts.total} total (${result.pairCounts.sameState} same-state, `
      + `${result.pairCounts.differingState} differing-state), ${result.pairSkips} pair skips`,
  )
  console.log(`silver exclusions: ${result.silverExclusions}`)
  console.log(`contracts: ${renderCounters(result.contracts)}`)
  console.log(`scaffold: ${renderCounters(result.scaffold)}`)
  console.log(pc.dim(`committed root: ${result.committedRoot}`))
}

/** Sum a per-TieCause disposition group into one scalar for the compact summary line (D-04). */
function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}

/** Compact report summary rendered from the DTO fields only — a faithful projection (D-04). */
function renderReportSummary(result: ReportVerbResult): void {
  const report = result.report
  console.log(
    pc.bold(`report: batch ${result.batchKey}`) + pc.dim(` (${result.entries} entries)`),
  )
  const accuracy = report.headline.firstAttemptDecisionAccuracy
  console.log(
    'headline: firstAttemptDecisionAccuracy '
      + `${accuracy.numerator}/${accuracy.denominator}`
      + (accuracy.rate === undefined ? ' (rate: n/a)' : ` (rate: ${accuracy.rate})`),
  )
  const cost = report.headline.perDecisionCost
  console.log(
    `per-decision cost: decisions=${cost.decisionCount} promptTokens=${cost.promptTokens} `
      + `completionTokens=${cost.completionTokens} totalTokens=${cost.totalTokens} `
      + `durationMs=${cost.durationMs}`,
  )
  console.log(`ties: ${renderCounters(report.honesty.tieCounts)}`)
  console.log(`refusals: ${renderCounters(report.honesty.refusalCounts)}`)
  const judge = report.honesty.judge
  console.log(
    `judge: ${sumCounts(judge.invoked)} invoked, ${sumCounts(judge.settled)} settled, `
      + `${sumCounts(judge.abstained)} abstained, ${sumCounts(judge.errors)} errors, `
      + `${sumCounts(judge.notInvoked)} not-invoked`,
  )
  console.log(`judge identity: ${result.judgeIdentity}`)
  for (const notice of result.notices) {
    console.log(pc.dim(notice))
  }
  console.log(pc.dim(`staged file: ${result.stagedFile}`))
  if (result.committed !== undefined) {
    // D-08: egress blocks and write conflicts are DATA — rendered loudly, never exit 1.
    if (result.committed.kind === 'committed') {
      console.log(
        `committed: json ${result.committed.json}, markdown ${result.committed.markdown}`,
      )
      console.log(pc.dim(`report dir: ${result.committed.reportDir}`))
    } else if (result.committed.kind === 'egress-blocked') {
      console.log(
        pc.red(
          'commit egress-blocked: '
            + result.committed.detections
              .map(detection => `${detection.label} (${detection.detector})`)
              .join(', '),
        ),
      )
    } else {
      console.log(pc.red(`commit write-conflict: ${result.committed.path}`))
    }
  }
}

/**
 * Compact census summary rendered from the DTO fields only — a faithful projection (D-04).
 *
 * D-16 discipline: every number here is copied out of the census, nothing is summed, rated or
 * interpreted at the console, and no threshold or minimum-n line exists to print. The cross-check
 * reconciliation lines and any comparator refusal ride in `notices`, so a same-family report is
 * disclosed on EVERY census run to the person actually reading the output (D-20, T-413-22).
 */
function renderCensusSummary(result: CensusVerbResult): void {
  const census = result.census
  const products = Object.keys(census.products).sort()
  console.log(
    pc.bold(`census: corpus ${result.corpusDigest}`)
      + pc.dim(
        ` (${result.entryCount} entries, products ${products.length === 0 ? 'none' : products.join(', ')})`,
      ),
  )
  for (const product of products) {
    const block = census.products[product]!
    console.log(
      `${product}: total=${block.total} `
        + `tier1=${block.scorableByTier.tier1} tier2=${block.scorableByTier.tier2} `
        + `tier3=${block.scorableByTier.tier3} goldEvidence=${block.goldEvidence} `
        + `proof=${block.proofCoverage.numerator}/${block.proofCoverage.denominator} `
        + `populatedBrief=${block.briefContent['populated-brief']} `
        + `blobsLocal=${block.blobsPresentLocally.numerator}/${block.blobsPresentLocally.denominator} `
        + `runsExcluded=${renderCounters(block.runsExcluded)} `
        + `rungs=${renderCounters(block.rungMix)}`,
    )
  }
  const campaign = census.campaign
  if (!campaign.present) {
    console.log('campaign: none supplied')
  } else {
    console.log(
      `campaign: legs=${campaign.legs} seeded=${campaign.runsSeeded} `
        + `excluded=${campaign.runsExcluded} modelCalls=${campaign.modelCalls} `
        + `promptTokens=${campaign.promptTokens} completionTokens=${campaign.completionTokens} `
        + `wallClockMs=${campaign.wallClockMs}`,
    )
  }
  for (const notice of result.notices) {
    // A comparator refusal is the one notice that must not read like housekeeping (ROOT-11).
    console.log(
      notice.startsWith('baseline comparator refused') ? pc.red(notice) : pc.dim(notice),
    )
  }
  if (result.committed !== undefined) {
    // 372 D-08: egress blocks and write conflicts are DATA — rendered loudly, never exit 1.
    if (result.committed.kind === 'committed') {
      console.log(
        `committed: json ${result.committed.json}, markdown ${result.committed.markdown}`,
      )
      console.log(pc.dim(`census dir: ${result.committed.censusDir}`))
    } else if (result.committed.kind === 'egress-blocked') {
      console.log(
        pc.red(
          'commit egress-blocked: '
            + result.committed.detections
              .map(detection => `${detection.label} (${detection.detector})`)
              .join(', '),
        ),
      )
    } else {
      console.log(pc.red(`commit write-conflict: ${result.committed.path}`))
    }
  }
}

/** Compact picocolors summary rendered from the DTO fields only — a faithful projection (D-04). */
function renderExtractSummary(result: ExtractVerbResult): void {
  console.log(
    pc.bold(`extract: swept ${result.runsSwept} run(s)`)
      + pc.dim(` (${result.runsSkipped.length} skipped, ${result.runsFiltered} filtered)`),
  )
  for (const skip of result.runsSkipped) {
    console.log(pc.yellow(`  skipped ${skip.runSlug}: ${skip.reason}`))
  }
  console.log(`cassettes written: ${result.cassettesWritten}`)
  const counters = Object.entries(result.completeness)
    .map(([name, count]) => `${name}=${count}`)
    .join(' ')
  console.log(`completeness: ${counters === '' ? pc.dim('none') : counters}`)
  console.log(pc.dim(`cassettes root: ${result.cassettesRoot}`))
}

export function createEvalCommand(): Command {
  const cmd = new Command('eval')
    .description('Offline eval substrate: extract, replay, seed, report, census (Phase 372 D-01; 413 D-13)')

  cmd.addCommand(
    new Command('extract')
      .description('Extract staged cassette bundles from recorded run handoffs')
      .option('--run <slug>', 'narrow to one recorded run')
      .option('--product <slug>', 'narrow by product scope')
      .option('--json', 'emit the typed result DTO to stdout')
      .action(
        async (
          opts: { run?: string; product?: string; json?: boolean },
          command: Command,
        ) => {
          try {
            const configPath = getGlobalConfigPath(command)
            const { resolveEvalSession, runExtractVerb } = await import(
              '../eval-session-composition.js'
            )
            const session = await resolveEvalSession(
              configPath === undefined ? {} : { configPath },
            )
            const result = await runExtractVerb(session, {
              ...(opts.run === undefined ? {} : { run: opts.run }),
              ...(opts.product === undefined ? {} : { product: opts.product }),
            })
            if (opts.json) {
              // D-04/Pitfall 11: exactly one JSON document on stdout — typed skips are DATA
              // inside the DTO, and any notice belongs on stderr.
              console.log(JSON.stringify(result, null, 2))
            } else {
              renderExtractSummary(result)
            }
          } catch (err) {
            // D-08: EvalNamedInputError and config/session resolution errors are the only
            // failure modes — the command layer maps them all to exit code 1.
            console.error(pc.red(err instanceof Error ? err.message : String(err)))
            process.exitCode = 1
          }
        },
      ),
  )

  cmd.addCommand(
    new Command('replay')
      .description('Replay staged cassette bundles through the production planner stack')
      .option('--run <slug>', 'narrow to cassettes extracted from one recorded run')
      .option('--cassette <id>', 'replay exactly one staged cassette by id')
      .option('--product <slug>', 'narrow by product scope')
      .option('--judge <name>', 'override the eval.judge named LLM config')
      .option('--k <n>', 'sample budget per cassette', parseIntegerFlag('--k'))
      .option('--seed <n>', 'replay sampling seed', parseIntegerFlag('--seed'))
      .option('--json', 'emit the typed result DTO to stdout')
      .action(
        async (
          opts: {
            run?: string
            cassette?: string
            product?: string
            judge?: string
            k?: number
            seed?: number
            json?: boolean
          },
          command: Command,
        ) => {
          try {
            const configPath = getGlobalConfigPath(command)
            const { resolveEvalSession, runReplayVerb } = await import(
              '../eval-session-composition.js'
            )
            // D-03: judge/k/seed flags flow into the session's field-wise flag merge — the verb
            // itself takes no judge/k/seed parameters.
            const session = await resolveEvalSession({
              ...(configPath === undefined ? {} : { configPath }),
              flags: {
                ...(opts.judge === undefined ? {} : { judge: opts.judge }),
                ...(opts.k === undefined ? {} : { k: opts.k }),
                ...(opts.seed === undefined ? {} : { seed: opts.seed }),
              },
            })
            const result = await runReplayVerb(session, {
              ...(opts.run === undefined ? {} : { run: opts.run }),
              ...(opts.cassette === undefined ? {} : { cassette: opts.cassette }),
              ...(opts.product === undefined ? {} : { product: opts.product }),
            })
            if (opts.json) {
              // D-04/Pitfall 11: exactly one JSON document on stdout — refusal counters, judge
              // dispositions, and notices are DATA inside the DTO; progress already rode stderr.
              console.log(JSON.stringify(result, null, 2))
            } else {
              renderReplaySummary(result)
            }
          } catch (err) {
            // D-08: typed named-input/config/auth errors are the only failure modes — refusal
            // counters and judge errors are data and never reach this catch.
            console.error(pc.red(err instanceof Error ? err.message : String(err)))
            process.exitCode = 1
          }
        },
      ),
  )

  cmd.addCommand(
    new Command('seed')
      .description('Commit measurement corpus cases into the reviewed committed root (explicit, D-01)')
      .option('--run <slug>', 'narrow to one recorded run')
      .option('--product <slug>', 'narrow by product scope')
      .option('--silver-cap <n>', 'per-test silver cap override', parseIntegerFlag('--silver-cap'))
      .option('--json', 'emit the typed result DTO to stdout')
      .action(
        async (
          opts: { run?: string; product?: string; silverCap?: number; json?: boolean },
          command: Command,
        ) => {
          try {
            const configPath = getGlobalConfigPath(command)
            const { resolveEvalSession, runSeedVerb } = await import(
              '../eval-session-composition.js'
            )
            // D-03: --silver-cap flows into the session's field-wise flag merge — the verb reads
            // it from session.evalConfig.seeding, exactly like judge/k/seed on replay.
            const session = await resolveEvalSession({
              ...(configPath === undefined ? {} : { configPath }),
              flags: {
                ...(opts.silverCap === undefined ? {} : { silverCap: opts.silverCap }),
              },
            })
            const result = await runSeedVerb(session, {
              ...(opts.run === undefined ? {} : { run: opts.run }),
              ...(opts.product === undefined ? {} : { product: opts.product }),
            })
            if (opts.json) {
              // D-04/Pitfall 11: exactly one JSON document on stdout — refusals and skips are
              // DATA inside the DTO, never separate stream noise.
              console.log(JSON.stringify(result, null, 2))
            } else {
              renderSeedSummary(result)
            }
          } catch (err) {
            // D-08: typed named-input/config errors are the only failure modes — seeding
            // refusals are data and never reach this catch.
            console.error(pc.red(err instanceof Error ? err.message : String(err)))
            process.exitCode = 1
          }
        },
      ),
  )

  cmd.addCommand(
    new Command('report')
      .description('Assemble the whole-corpus baseline report from persisted replay records')
      .option('--run <slug>', 'narrow to records extracted from one recorded run')
      .option('--cassette <id>', 'report over exactly one persisted record by cassette id')
      .option('--product <slug>', 'narrow by product scope')
      .option('--commit', 'also write report.json + report.md into the committed root (D-13)')
      .option('--json', 'emit the typed result DTO to stdout')
      .action(
        async (
          opts: {
            run?: string
            cassette?: string
            product?: string
            commit?: boolean
            json?: boolean
          },
          command: Command,
        ) => {
          try {
            const configPath = getGlobalConfigPath(command)
            const { resolveEvalSession, runReportVerb } = await import(
              '../eval-session-composition.js'
            )
            const session = await resolveEvalSession(
              configPath === undefined ? {} : { configPath },
            )
            const result = await runReportVerb(
              session,
              {
                ...(opts.run === undefined ? {} : { run: opts.run }),
                ...(opts.cassette === undefined ? {} : { cassette: opts.cassette }),
                ...(opts.product === undefined ? {} : { product: opts.product }),
              },
              { ...(opts.commit === undefined ? {} : { commit: opts.commit }) },
            )
            if (opts.json) {
              // D-04/Pitfall 11: exactly one JSON document on stdout — the committed outcome
              // (incl. egress blocks and write conflicts) is DATA inside the DTO (D-08).
              console.log(JSON.stringify(result, null, 2))
            } else {
              renderReportSummary(result)
            }
          } catch (err) {
            // D-08: typed named-input/config errors are the only failure modes — egress-blocked
            // and write-conflict committed outcomes are data and never reach this catch.
            console.error(pc.red(err instanceof Error ? err.message : String(err)))
            process.exitCode = 1
          }
        },
      ),
  )

  cmd.addCommand(
    new Command('census')
      .description(
        'Derive the static per-product corpus census from the committed root (D-13/D-14)',
      )
      .option(
        '--commit',
        'also write census.json + census.md under reports/census/<corpus-digest>/ (D-15)',
      )
      .option(
        '--campaign <path>',
        'fold a guarded campaign manifest (excluded runs, repeats, cost line) into the census (D-16)',
      )
      .option('--json', 'emit the typed result DTO to stdout')
      .action(
        async (
          opts: { commit?: boolean; campaign?: string; json?: boolean },
          command: Command,
        ) => {
          try {
            const configPath = getGlobalConfigPath(command)
            const { resolveEvalSession, runCensusVerb } = await import(
              '../eval-session-composition.js'
            )
            const session = await resolveEvalSession(
              configPath === undefined ? {} : { configPath },
            )
            const result = await runCensusVerb(session, {
              ...(opts.commit === undefined ? {} : { commit: opts.commit }),
              ...(opts.campaign === undefined ? {} : { campaign: opts.campaign }),
            })
            if (opts.json) {
              // D-04/Pitfall 11: exactly one JSON document on stdout — cross-check refusals and
              // read refusals are DATA inside the DTO, never separate stream noise.
              console.log(JSON.stringify(result, null, 2))
            } else {
              renderCensusSummary(result)
            }
          } catch (err) {
            // D-08: a rejected --campaign manifest and a config/session failure are the only
            // failure modes — egress-blocked and write-conflict outcomes are data (T-413-21/24).
            console.error(pc.red(err instanceof Error ? err.message : String(err)))
            process.exitCode = 1
          }
        },
      ),
  )

  return cmd
}
