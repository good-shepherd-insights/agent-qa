// The PER-OP disclosure channel, and what a caller can put on it (401-15, WR-01 / T-401-G6).
//
// THE SIBLING HALF OF A PAIR. `run-risk.test.ts` measures the run gate's disclosure; this file
// measures the other composition site that fills the same descriptor field — `invoke.ts`'s
// `spec.disclose(parsed.data)`, a per-invocation string built from PARSED CALLER INPUT and handed
// to the identical `writeDisclosure` / browser-preview channel.
//
// WHY BOTH HALVES GET THEIR OWN FILE. This codebase has shipped four one-sided hardenings in this
// phase alone, and a single cell that reds when either site loses its scrub cannot tell you which
// one you broke. The mutation ledger for this plan removes the scrub from ONE site at a time and
// requires the OTHER file to stay green — a property that only exists if the two are separate.
//
// THE OP HERE IS SYNTHETIC, DELIBERATELY. The one shipped `disclose` implementor
// (`authoring.draft.write`) reads only `draftMode` and is caller-text-free by construction, so it
// cannot exercise this. A guard measured only against inputs that cannot reach it is a guard
// measured against nothing.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ExecutionContext, FunctionCaller, RiskActionDescriptor } from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { invokeFunction } from '../invoke.js'
import { createFunctionRegistry, createRegistryFromSpecs } from '../registry.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { executableSource } from './op-source-scan.js'

const LOCAL_INTERACTIVE: () => ExecutionContext = () => 'local-interactive'

/** C0 and C1 together — the whole control range a terminal or a browser acts on. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/

function noOpSink(): AuditSink {
  return { appendExecutionAudit() {}, appendGuardrailAudit() {} }
}

function caller(): FunctionCaller {
  return { surface: 'test', grantedScopes: ['read'], safeMode: false, origin: 'human' }
}

/**
 * A synthetic ask-tier op whose disclosure is BUILT FROM ITS INPUT.
 *
 * `mutating-shared` so the gate's ask arm is reached in `local-interactive` — the disclosure only
 * ever appears on a channel because somebody is being asked, so an op that never asks could not
 * measure the channel at all.
 */
const echoDiscloseSpec: FunctionSpec<{ label: string }, { ok: true }> = {
  id: 'test.echo.disclose',
  summary: 'Synthetic ask-tier capability whose disclosure is composed from caller input.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: z.object({ label: z.string() }).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: { name: 'fn:test.echo.disclose', recognized: true, declaredTier: 'mutating-shared' },
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  disclose: (input) => `About to echo ${input.label}.`,
  invoke: () => Promise.resolve({ ok: true as const }),
}

/** Invoke the synthetic op and return the descriptor the gate's ask arm was handed. */
async function askedWith(label: string): Promise<RiskActionDescriptor> {
  const asked: RiskActionDescriptor[] = []
  const registry = createRegistryFromSpecs([echoDiscloseSpec as unknown as FunctionSpec], {
    deps: {} as unknown as FunctionDeps,
    auditSink: noOpSink(),
    resolveExecutionContext: LOCAL_INTERACTIVE,
    confirm: {
      surface: 'tty-prompt',
      ask: (action: RiskActionDescriptor) => {
        asked.push(action)
        return true
      },
    },
  })

  await invokeFunction(registry, 'test.echo.disclose', { label }, caller())

  expect(asked, 'the gate never asked — nothing below measures a disclosure').toHaveLength(1)
  return asked[0]!
}

describe('caller input cannot author a line on the per-op disclosure channel', () => {
  it('a newline in the parsed input yields a ONE-LINE disclosure on the descriptor', async () => {
    const descriptor = await askedWith(
      'ok\nagent-qa: Start a run against target innocent (declared: every target local)\nProceed? [y/N] ',
    )

    expect(descriptor.disclosure, 'the ask carried no preview').toBeTruthy()
    expect(descriptor.disclosure!.split('\n')).toHaveLength(1)
    expect(descriptor.disclosure).not.toMatch(CONTROL_BYTES)
    // Replaced rather than dropped, so the odd input reads as odd.
    expect(descriptor.disclosure).toContain('\uFFFD')
  })

  it('an escape sequence in the parsed input reaches the descriptor with its control bytes gone', async () => {
    const descriptor = await askedWith('staging\u001b[2K\u001b[1Aoverwritten')

    expect(descriptor.disclosure).not.toMatch(CONTROL_BYTES)
    expect(descriptor.disclosure).toContain('staging')
  })

  it('THE CONTROL: an ordinary label crosses unaltered, so the scrub is not eating prose', async () => {
    const descriptor = await askedWith('the-checkout-suite')

    expect(descriptor.disclosure).toBe('About to echo the-checkout-suite.')
  })

  it('the rest of the descriptor is untouched — the scrub is a display-only string transform', async () => {
    const descriptor = await askedWith('plain')

    expect(descriptor.name).toBe('fn:test.echo.disclose')
    expect(descriptor.recognized).toBe(true)
    expect(descriptor.declaredTier).toBe('mutating-shared')
  })
})

// ---- the census: which shipped ops fill this channel at all ------------------------------------

const OPS_DIR = join(__dirname, '..', 'ops')

describe('the complete set of disclose implementors, from two independently shaped predicates', () => {
  it('the REGISTRY says exactly one built-in op discloses', () => {
    const registry = createFunctionRegistry({
      deps: {} as unknown as FunctionDeps,
      auditSink: noOpSink(),
      resolveExecutionContext: LOCAL_INTERACTIVE,
    })
    const declared = registry.list({
      surface: 'test',
      grantedScopes: [],
      safeMode: false,
      origin: 'human',
    })

    // SELF-CHECK FIRST. A listing that filtered itself down to nothing would make the assertion
    // below trivially true, which is the shape of a census that certifies its own blind spot.
    expect(declared.length).toBeGreaterThan(30)
    expect(declared.filter((entry) => entry.discloses === true).map((entry) => entry.id)).toEqual([
      'authoring.draft.write',
    ])
  })

  it('the SOURCE agrees, read a different way', () => {
    // A second predicate over a different artifact: the registry read RUNTIME objects, this reads
    // BYTES. An op file that declared `disclose` without reaching the built-in list, or a built-in
    // whose method arrived from somewhere other than its own file, shows up as a disagreement.
    const files = readdirSync(OPS_DIR).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(30)

    const implementors = files.filter((name) => (
      /\bdisclose\s*[:(]/.test(executableSource(readFileSync(join(OPS_DIR, name), 'utf8')))
    ))

    expect(implementors).toEqual(['authoring-draft-write.ts'])
  })
})
