// `agent-qa proposals` — the inbox, the decision, and the standing grants (Phase 391, D-17).
//
// §3.3's missing surface, reached from a terminal. Every verb here is a THIN WRAPPER over an op
// the function layer already publishes: resolve a root, build the registry at the composition
// root, call `invokeFunction`, render the arm that came back. The commands own no capability,
// no store handle and no policy — a surface that could decide a proposal without crossing
// `invokeFunction` would be a second door to the same power, which is exactly what the phase's
// one-door law forbids.
//
// THE ACCEPT ESCALATION IS A FLAG, NOT A VERB (D-01), and the CLI spells it the way the op
// does: `accept <id>` applies this proposal only, `accept <id> --always` also records a standing
// approval. Two commands would have made "apply this" and "apply this and stop asking" two
// capabilities a surface chooses between — and standing approval would become reachable without
// deciding anything. One decision surface, one escalation you have to ask for.
//
// THE MINT REFUSAL IS PRINTED VERBATIM AND BESIDE THE APPLY, never instead of it. The op returns
// two independent fields precisely because an accept-with-always whose apply COMMITTED and whose
// mint was REFUSED has to report both halves truthfully; a renderer that folded them would force
// a choice between losing a receipt for a commit that happened and swallowing a refusal — which
// is how a person ends up believing they hold an approval they do not.
//
// GRANTS SIT UNDER `proposals` rather than beside it: a standing approval exists only because
// somebody accepted a proposal with the escalation, so the way back is where the way in is.

import { dirname, resolve } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type {
  GrantsListOutput,
  GrantsRevokeOutput,
  ProposalInboxEntryDto,
  ProposalsAcceptOutput,
  ProposalsListOutput,
  ProposalsRejectOutput,
  ProposalsShowOutput,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'

/**
 * The six capabilities this surface is a client of.
 *
 * Literals for the reason `entities.ts` writes its own: an id is a wire name, and a surface that
 * could only name a capability by importing its declaration would be coupled to the declaring
 * module rather than to the contract.
 */
const PROPOSALS_LIST_ID = 'proposals.list'
const PROPOSALS_SHOW_ID = 'proposals.show'
const PROPOSALS_ACCEPT_ID = 'proposals.accept'
const PROPOSALS_REJECT_ID = 'proposals.reject'
const GRANTS_LIST_ID = 'grants.list'
const GRANTS_REVOKE_ID = 'grants.revoke'

interface JsonOption {
  json?: boolean
}

function compositionInput(command: Command): { agentQaRoot: string; configPath: string } {
  // Two levels up for a subcommand of `proposals`, three for one under `proposals grants`.
  const configPath = resolve(
    command.parent?.parent?.parent?.opts<{ config?: string }>().config
    ?? command.parent?.parent?.opts<{ config?: string }>().config
    ?? command.parent?.opts<{ config?: string }>().config
    ?? 'agent-qa.config.yaml',
  )
  return { agentQaRoot: resolve(dirname(configPath), '.agent-qa'), configPath }
}

/**
 * ONE dispatch path for every verb on this surface.
 *
 * The host is closed in a `finally` because these verbs open the durable stores; a one-shot
 * command that leaves a handle open is a handle the next command inherits.
 */
async function invokeOp(
  command: Command,
  functionId: string,
  input: unknown,
): Promise<unknown> {
  const host = composeCliLocalAgent(compositionInput(command))
  try {
    return await invokeFunction(host.registry, functionId, input, CLI_FUNCTION_CALLER)
  } finally {
    await host.close()
  }
}

function emit(options: JsonOption, value: unknown, human: string): void {
  if (options.json === true) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  console.log(human)
}

function reportError(verb: string, error: unknown): void {
  console.error(pc.red(
    `Proposals error [${verb}/${error instanceof Error ? error.name : 'unknown'}]: ${
      error instanceof Error ? error.message : String(error)}`,
  ))
  process.exitCode = 1
}

/** One inbox row — the envelope's own facts, and never its payload's contents. */
function renderEntry(entry: ProposalInboxEntryDto): string {
  const { envelope } = entry
  const origin = envelope.origin
  return [
    `${pc.bold(envelope.id)}  ${envelope.status}${entry.applyInFlight ? ' (apply in flight)' : ''}`,
    `  ${envelope.kind}: ${envelope.payload.verb}`,
    ...(origin === undefined
      ? []
      : [`  from ${origin.emittedBy}${origin.runId === undefined ? '' : ` · run ${origin.runId}`}`]),
    ...(envelope.decision === undefined
      ? []
      : [`  decided ${envelope.decision.decision}${
          envelope.decision.reason === undefined ? '' : ` — ${envelope.decision.reason}`}`]),
    ...(envelope.evidenceRefs.length === 0
      ? []
      : [`  evidence: ${envelope.evidenceRefs.map((ref) => `${ref.grain} ${ref.ref}`).join(', ')}`]),
  ].join('\n')
}

/**
 * The FULL entry, receipts included — the one place in this surface where evidence is rendered.
 *
 * That asymmetry is D-18's boundary made concrete: the digest and the listing carry refs and
 * counts, and `show` is the verb a person deliberately reaches for when they want the bytes.
 */
function renderShow(result: ProposalsShowOutput): string {
  if (result.kind === 'not-found') {
    return pc.dim(`No proposal is recorded under ${result.proposalId}.`)
  }
  return [
    renderEntry(result.entry),
    '',
    JSON.stringify(result.entry.envelope.payload, null, 2),
  ].join('\n')
}

/** The grant half, printed VERBATIM beside the apply half — never instead of it (D-01/D-05). */
function renderGrantOutcome(grant: ProposalsAcceptOutput['grant']): string {
  switch (grant.kind) {
    case 'not-requested':
      return pc.dim('standing approval: not requested (pass --always to record one)')
    case 'not-applied':
      return pc.dim('standing approval: not recorded — the apply did not happen')
    case 'recorded':
      return `standing approval RECORDED for ${grant.grant.actionClass} (${grant.grant.grantId})`
    case 'already-granted':
      return `standing approval already in force for ${grant.grant.actionClass} `
        + `(${grant.grant.grantId})`
    case 'protected-class':
      // The sovereignty refusal, in the op's own words. Printed on its own line so it cannot be
      // read as a footnote to the apply that DID happen one line up.
      return pc.yellow(
        `standing approval REFUSED: ${grant.actionClass} is a protected class — `
        + 'no standing approval can ever cover it, and this proposal was applied anyway.',
      )
  }
}

function renderAccept(result: ProposalsAcceptOutput): string {
  const apply = result.apply
  const applyLine = apply.outcome === 'applied'
    ? `applied (${apply.applied.kind})`
    : apply.outcome === 'not-found' || apply.outcome === 'apply-in-flight'
      ? `${apply.outcome}: ${apply.proposalId}`
      : `${apply.outcome}: ${apply.entry.envelope.id}`
  return [applyLine, renderGrantOutcome(result.grant)].join('\n')
}

function renderReject(result: ProposalsRejectOutput): string {
  return result.outcome === 'not-found' || result.outcome === 'apply-in-flight'
    ? `${result.outcome}: ${result.proposalId}`
    : `${result.outcome}\n${renderEntry(result.entry)}`
}

/**
 * The damage report, on the quarantine ledger's wording.
 *
 * Rendered in BOTH fold arms: the operator who most needs it is the one whose ledger still lists
 * approvals, because those approvals no longer authorize anything while a line stays unreadable.
 */
function renderRefusedLines(result: GrantsListOutput): string[] {
  if (result.refusedLines.length === 0) return []
  return [
    '',
    pc.yellow(
      `The grant ledger has ${result.refusedLines.length} unreadable line(s): ${
        result.refusedLines
          .map((line) => `line ${line.lineNumber} (${line.reason})`)
          .join(', ')
      }. Until they are repaired no standing approval authorizes anything.`,
    ),
  ]
}

function renderGrantsList(result: GrantsListOutput): string {
  if (result.grants.length === 0) {
    return [
      pc.dim('No standing approvals are in force. Every ask reaches you.'),
      ...renderRefusedLines(result),
    ].join('\n')
  }
  return [
    pc.bold(`Standing approvals in force (${result.grants.length})`),
    '',
    ...result.grants.map((grant) => [
      `${pc.bold(grant.grantId)}  ${grant.actionClass}`,
      `  scope: ${JSON.stringify(grant.scope)}`,
      `  granted: ${grant.grantedAt}${
        grant.proposalId === undefined ? '' : ` · from ${grant.proposalId}`}`,
    ].join('\n')),
    ...renderRefusedLines(result),
  ].join('\n')
}

export function createProposalsCommand(): Command {
  const command = new Command('proposals')
    .description('Enumerate, read and decide the proposals waiting on you')

  command
    .command('list')
    .description('List every proposal awaiting, or already carrying, a decision')
    .option('--status <status>', 'pending | applied | rejected | expired')
    .option('--kind <kind>', 'restrict to one proposal kind')
    .option('--json', 'emit machine-readable JSON')
    .action(async (
      options: JsonOption & { status?: string; kind?: string },
      listCommand: Command,
    ) => {
      try {
        const result = await invokeOp(listCommand, PROPOSALS_LIST_ID, {
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
        }) as ProposalsListOutput
        emit(
          options,
          result,
          result.entries.length === 0
            ? pc.dim('Nothing is waiting on you.')
            : [
                pc.bold(`Proposals (${result.entries.length})`),
                '',
                ...result.entries.map(renderEntry),
              ].join('\n'),
        )
      } catch (error) {
        reportError('list', error)
      }
    })

  command
    .command('show')
    .description('Render one proposal in full — the receipts, before any decision')
    .argument('<proposalId>', 'the proposal id, as `list` prints it')
    .option('--json', 'emit machine-readable JSON')
    .action(async (proposalId: string, options: JsonOption, showCommand: Command) => {
      try {
        const result = await invokeOp(
          showCommand,
          PROPOSALS_SHOW_ID,
          { proposalId },
        ) as ProposalsShowOutput
        emit(options, result, renderShow(result))
      } catch (error) {
        reportError('show', error)
      }
    })

  command
    .command('accept')
    .description('Apply one proposal; --always also records a standing approval for its class')
    .argument('<proposalId>', 'the proposal id, as `list` prints it')
    .option('--always', 'ALSO record a standing approval covering this kind\'s apply verb')
    .option('--json', 'emit machine-readable JSON')
    .action(async (
      proposalId: string,
      options: JsonOption & { always?: boolean },
      acceptCommand: Command,
    ) => {
      try {
        const result = await invokeOp(acceptCommand, PROPOSALS_ACCEPT_ID, {
          proposalId,
          // ABSENT MEANS NO. The op's contract admits only the literal `true`, so there is no
          // default and no tri-state — a grant is minted by asking and by nothing else.
          ...(options.always === true ? { always: true as const } : {}),
        }) as ProposalsAcceptOutput
        emit(options, result, renderAccept(result))
      } catch (error) {
        reportError('accept', error)
      }
    })

  command
    .command('reject')
    .description('Decline one proposal, permanently')
    .argument('<proposalId>', 'the proposal id, as `list` prints it')
    .option('--reason <reason>', 'why — recorded on the decision trail when supplied')
    .option('--json', 'emit machine-readable JSON')
    .action(async (
      proposalId: string,
      options: JsonOption & { reason?: string },
      rejectCommand: Command,
    ) => {
      try {
        const result = await invokeOp(rejectCommand, PROPOSALS_REJECT_ID, {
          proposalId,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        }) as ProposalsRejectOutput
        emit(options, result, renderReject(result))
      } catch (error) {
        reportError('reject', error)
      }
    })

  const grants = command
    .command('grants')
    .description('The standing approvals accept --always recorded, and the way back')

  grants
    .command('list')
    .description('Every standing approval currently in force')
    .option('--json', 'emit machine-readable JSON')
    .action(async (options: JsonOption, grantsListCommand: Command) => {
      try {
        const result = await invokeOp(
          grantsListCommand,
          GRANTS_LIST_ID,
          {},
        ) as GrantsListOutput
        emit(options, result, renderGrantsList(result))
      } catch (error) {
        reportError('grants list', error)
      }
    })

  grants
    .command('revoke')
    .description('Withdraw one standing approval — the next matching ask reaches you again')
    .argument('<grantId>', 'the grant id, as `grants list` prints it')
    .option('--json', 'emit machine-readable JSON')
    .action(async (grantId: string, options: JsonOption, revokeCommand: Command) => {
      try {
        const result = await invokeOp(
          revokeCommand,
          GRANTS_REVOKE_ID,
          { grantId },
        ) as GrantsRevokeOutput
        emit(
          options,
          result,
          result.outcome === 'no-grant'
            ? pc.dim(`No standing approval is in force under ${result.grantId}.`)
            : `revoked ${result.grant.grantId} — ${result.grant.actionClass} asks again`,
        )
      } catch (error) {
        reportError('grants revoke', error)
      }
    })

  return command
}
