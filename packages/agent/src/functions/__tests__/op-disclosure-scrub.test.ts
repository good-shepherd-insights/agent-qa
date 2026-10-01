// The PER-OP disclosure channel, and what a caller can put on it (401-15, WR-01 / T-401-G6).
//
// 2026-09-30 (432-13, D-14): THE CHANNEL IS GONE. `invoke.ts` used to compose
// `spec.disclose(parsed.data)` into the descriptor it handed the op gate, which is the string a
// confirm prompt or a browser preview printed above the question. There is no op gate and nothing
// asks, so dispatch composes no disclosure at all. The cells that proved the scrub on that channel
// are re-spelled as the channel's absence: hostile caller text reaches no preview because no
// preview is built. The census below (which ops still declare `disclose`) is unchanged.
//
// THE OP HERE IS SYNTHETIC, DELIBERATELY. The one shipped `disclose` implementor
// (`authoring.draft.write`) reads only `draftMode` and is caller-text-free by construction.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { FunctionCaller } from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { invokeFunction } from '../invoke.js'
import { createFunctionRegistry, createRegistryFromSpecs } from '../registry.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { executableSource } from './op-source-scan.js'

// 2026-10-01 (432-29, D-12): the retired `resolveExecutionContext` registry option, the retired
// `grantedScopes` and `safeMode` caller fields and the synthetic spec's `requiredScopes` are
// dropped; nothing read them.

/** C0 and C1 together — the whole control range a terminal or a browser acts on. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/

function noOpSink(): AuditSink {
  return { appendGuardrailAudit() {} }
}

function caller(): FunctionCaller {
  return { surface: 'test', origin: 'human' }
}

/**
 * A synthetic formerly-ask-tier op whose disclosure is BUILT FROM ITS INPUT, with a counter on it.
 */
function echoDiscloseSpec(disclosed: string[]): FunctionSpec<{ label: string }, { ok: true }> {
  return {
    id: 'test.echo.disclose',
    summary: 'Synthetic capability whose disclosure is composed from caller input.',
    resultKind: 'unary',
    input: z.object({ label: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    risk: { name: 'fn:test.echo.disclose', recognized: true, declaredTier: 'mutating-shared' },
    classify: () => ({ status: 'executed' as const, outcome: '' }),
    disclose: (input) => {
      const text = `About to echo ${input.label}.`
      disclosed.push(text)
      return text
    },
    invoke: () => Promise.resolve({ ok: true as const }),
  }
}

describe('C432-INVOKE-DIRECT: dispatch composes no per-op disclosure (432-13)', () => {
  // RE-SPELLED 2026-09-30 (432-13) from 'a newline in the parsed input yields a ONE-LINE disclosure
  // on the descriptor' and 'an escape sequence ... reaches the descriptor with its control bytes
  // gone'. With no gate there is no descriptor for a caller's bytes to reach.
  it.each([
    'ok\nagent-qa: Start a run against target innocent (declared: every target local)\nProceed? [y/N] ',
    'staging\u001b[2K\u001b[1Aoverwritten',
    'the-checkout-suite',
  ])('C432-INVOKE-DIRECT: %j is dispatched once and composed into no disclosure', async (label) => {
    const disclosed: string[] = []
    const registry = createRegistryFromSpecs(
      [echoDiscloseSpec(disclosed) as unknown as FunctionSpec],
      {
        deps: {} as unknown as FunctionDeps,
        auditSink: noOpSink(),
      },
    )

    await expect(invokeFunction(registry, 'test.echo.disclose', { label }, caller()))
      .resolves.toEqual({ ok: true })
    expect(disclosed).toEqual([])
    expect(CONTROL_BYTES.test(label) || label === 'the-checkout-suite').toBe(true)
  })

  it('the source agrees: invokeFunction reads no disclose member and names no scrub', () => {
    const source = executableSource(readFileSync(join(__dirname, '..', 'invoke.ts'), 'utf8'))
    expect(source).not.toMatch(/\.disclose\b/)
    expect(source).not.toMatch(/scrubDisclosureText/)
    // Non-vacuity: the file really is the dispatcher.
    expect(source).toContain('export async function invokeFunction(')
  })
})

// ---- the census: which shipped ops fill this channel at all ------------------------------------

const OPS_DIR = join(__dirname, '..', 'ops')

describe('the complete set of disclose implementors, from two independently shaped predicates', () => {
  it('the REGISTRY says exactly one built-in op discloses', () => {
    const registry = createFunctionRegistry({
      deps: {} as unknown as FunctionDeps,
      auditSink: noOpSink(),
    })
    const declared = registry.list({
      surface: 'test',
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
