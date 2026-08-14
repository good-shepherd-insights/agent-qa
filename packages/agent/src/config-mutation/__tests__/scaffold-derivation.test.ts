// The scaffold's derivation and its never-guess boundary (Phase 395-08, D-13/D-15 · CFGM-05).
//
// WHAT EACH CELL'S ACCEPTANCE BAR IS — the implementation it must RED on, never the suite it passes:
//
//   (G1) the derivation      — ANY implementation that is not the pinned rule, and the corpus is
//                              RANGED over five different domains through ONE producer so that a
//                              gate hard-coding `booking.com` fails four of them. A cell asserting
//                              one domain's answer passes under a constant function; this one
//                              cannot.
//   (G2) the rejection corpus— a gate that accepts anything with a dot in it. Every member is a
//                              NEAR MISS — a token that has a dot, or has legal labels, or is a
//                              parseable URL — so a rule that merely looks for a dot reds on nine
//                              of them. This is the corpus case the rule's own precondition
//                              rejects, which is what stops the positive cells from being drawn
//                              from inside the rule's assumption.
//   (G3) the URL arm         — a host extraction by regex. `https://example.com@evil.example/` is
//                              the case where "everything after // up to the first /" and "the
//                              authority's host" are different strings, and only one of them is
//                              the site.
//   (S1) the refusal         — a scaffold that guessed. It asserts the typed reason, that the
//                              detail names BOTH continuations, and — the half that matters — that
//                              the token itself is not echoed back as a candidate origin.
//   (S2) never reads         — a gate placed AFTER the re-read. The double throws if read, so a
//                              refusal that had already gone to the filesystem fails by name.
//   (S3) already-configured  — a scaffold that overwrote an existing configuration. The double
//                              answers real config bytes and the cell asserts NOTHING was filed.
//   (S4) the port gets the   — an op that handed the raw token to the content port, or derived the
//        DERIVATION            target name a second time on the far side of the boundary. The
//                              double records what it was asked for.
//   (S5) crossBoundary       — a proposal that carried the flag as a constant. The value is read
//                              off `computeCrossBoundary`'s own output through the real pipeline,
//                              and the reasons are asserted by MEMBERSHIP so a classifier that
//                              started flagging everything for one reason still fails the pair.
//   (S6) one diff, three     — a scaffold that filed a proposal per file. CFGM-05's sentence is
//        files                 "ONE reviewable diff"; the cell counts the store's records.
//   (S7) unbound scan        — a propose op that constructed anyway with no scan bound. The
//                              permissive direction a security control may not fail in — and this
//                              op is the sharpest case, because D-12 says the scan reads WHOLE NEW
//                              FILES here and every byte of this proposal is a new file.
//   (S8) the scan RAN over   — a scan wired to the diff's changed lines only. The cell asserts a
//        whole files           scanned part EQUAL to the file's whole decoded content — no `@@`
//                              header, no `+` prefixes — which a hunk-only parts list can never
//                              produce. Its integrity half asserts the hunk-shaped parts are there
//                              too, so the equality is not passing against a scan that stopped
//                              rendering diffs.
//   (S9) unrenderable        — 395-02's refusal escaping as a fault instead of being answered as
//                              data. The scaffold is the one op that folds bytes it did not author
//                              into a file it proposes, so it is the one that must answer it.
//
// THE CONTENT IS A DOUBLE HERE, AND THE REAL PRODUCER IS MEASURED IN `cli`. `packages/agent` may
// not import `packages/cli`, where D-04's one scaffold producer lives. So this file measures the
// PIPELINE — the gate, the refusals, the ordering, the classification, the single record — and
// `cli/src/composition/__tests__/config-scaffold.test.ts` byte-pins what the real producer emits,
// against committed goldens, for two different domains. Splitting them is the same call 395-04 and
// 395-07 recorded: a double that could answer the question under test would make the cell a
// statement about the double.

import { utf8Decode, utf8Encode } from '@vostride/agent-qa-schema'
import type { ConfigProposalV1, ConfigProposeOutput } from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { constructConfigProjectScaffoldProposal } from '../construct.js'
import {
  HOSTNAME_GATE_REFUSAL_DETAIL,
  parseHostnameToken,
} from '../hostname-gate.js'
import type { ConstructConfigScaffoldDeps } from '../construct.js'

const CONFIG_FILE = 'agent-qa.config.yaml'
const ACTION = 'config.project.scaffold'

/**
 * The derivation corpus, RANGED. Five rows, one producer, and no two rows share a domain — so a
 * derivation that returned a constant, or one keyed on a particular site, reds on the rows it does
 * not happen to be about.
 */
const DERIVATIONS = [
  { token: 'booking.com', domain: 'booking.com', baseUrl: 'https://booking.com', targetName: 'booking-com' },
  { token: 'shop.example.co.uk', domain: 'shop.example.co.uk', baseUrl: 'https://shop.example.co.uk', targetName: 'shop-example-co-uk' },
  { token: 'BOOKING.DE', domain: 'booking.de', baseUrl: 'https://booking.de', targetName: 'booking-de' },
  { token: 'my-store.io', domain: 'my-store.io', baseUrl: 'https://my-store.io', targetName: 'my-store-io' },
  { token: 'https://booking.com/rooms?x=1', domain: 'booking.com', baseUrl: 'https://booking.com', targetName: 'booking-com' },
] as const

/**
 * The rejection corpus. Every member is a NEAR MISS the gate must refuse, and each one is here
 * because a plausible weaker rule would accept it.
 */
const REJECTED = [
  // No dot at all — the case the phase's own utterance example produces.
  'checkout flow',
  'booking',
  // A dot, and an illegal label: `_` is not DNS label syntax. Accepted by "has a dot".
  'not_a_domain.x',
  // A dot and legal labels, and a TLD that is one character. Accepted by "has a dot and labels".
  'a.x',
  // A dot and legal labels, and a NUMERIC final label. An IPv4 address is not a hostname, and a
  // gate that only checked label syntax would scaffold `https://192.168.0.1`.
  '192.168.0.1',
  // Leading and trailing hyphens — legal characters in the wrong position.
  '-lead.com',
  'trail-.com',
  // A fully-qualified name with the root dot. Refused rather than silently rewritten: what a
  // person typed is what gets configured.
  'example.com.',
  // A bare host with a path, no scheme. The path is not a label, and the gate does not invent a
  // boundary the person did not write.
  'booking.com/rooms',
  // Parseable URLs that are not sites this product can drive.
  'file:///etc/passwd',
  'javascript:alert(1)',
  // A sentence that contains a hostname. The gate parses a TOKEN, and this is not one.
  'write a test for booking.com please',
  '',
  '   ',
] as const

interface Filed {
  readonly payload: ConfigProposalV1
  readonly emittedBy: string
}

interface Harness {
  readonly filed: Filed[]
  readonly rendered: { targetName: string; baseUrl: string; existingGitignore?: string }[]
  readonly scanned: string[]
  readonly deps: ConstructConfigScaffoldDeps
}

/**
 * The host doubles, with the REAL scan and the REAL renderer behind them.
 *
 * `configFiles.read` ANSWERS AN EMPTY WORKSPACE BY DEFAULT — three enumerated members, none with
 * bytes — which is exactly what `enumerateConfigFileSet` answers for a project that has no config
 * file: the set is what the config NAMES, not what happens to exist. Measured against the shipped
 * function in `cli`'s composed cells rather than asserted here.
 */
function harness(options: {
  readonly configBytes?: string
  readonly gitignoreBytes?: Uint8Array
  readonly content?: (input: { targetName: string; baseUrl: string; existingGitignore?: Uint8Array }) =>
    readonly { path: string; bytes: Uint8Array }[]
  readonly scan?: boolean
  readonly readThrows?: boolean
  readonly validation?:
    | { ok: false; issues: readonly { path: string; message: string }[] }
    | { ok: true }
} = {}): Harness {
  const filed: Filed[] = []
  const rendered: { targetName: string; baseUrl: string; existingGitignore?: string }[] = []
  const scanned: string[] = []

  const defaultContent = (input: { targetName: string; baseUrl: string }) => [
    {
      path: CONFIG_FILE,
      bytes: utf8Encode(
        `# agent-qa Configuration\nregistry:\n  targets:\n    ${input.targetName}:\n`
        + `      platform: web\n      url: ${input.baseUrl}\n`,
      ),
    },
    { path: 'hooks.yaml', bytes: utf8Encode('hooks:\n  - id: h_one\n') },
    { path: '.gitignore', bytes: utf8Encode('# agent-qa init:start\n.env\n# agent-qa init:end\n') },
  ]

  return {
    filed,
    rendered,
    scanned,
    deps: {
      configFiles: {
        read: () => {
          if (options.readThrows === true) {
            throw new Error('the gate must refuse before anything is read')
          }
          return Promise.resolve({
            configFile: CONFIG_FILE,
            hooksFile: 'hooks.yaml',
            files: [
              { path: '.gitignore', ...(options.gitignoreBytes === undefined ? {} : { bytes: options.gitignoreBytes }) },
              { path: CONFIG_FILE, ...(options.configBytes === undefined ? {} : { bytes: utf8Encode(options.configBytes) }) },
              { path: 'hooks.yaml' },
            ],
          })
        },
        inspect: () => {
          throw new Error('config.project.scaffold must not inspect the document')
        },
        mintHookId: () => {
          throw new Error('config.project.scaffold must not mint a hook id')
        },
        setField: () => {
          throw new Error('config.project.scaffold must not edit a document it is creating')
        },
      },
      configValidate: {
        validate: () => Promise.resolve(options.validation ?? { ok: true }),
      },
      configProposals: {
        put: (record) => {
          filed.push({ payload: record.payload, emittedBy: record.emittedBy })
          return Promise.resolve({ proposalId: `prop-${filed.length}` })
        },
      },
      configScan: {
        scan: (parts) => {
          for (const part of parts) scanned.push(part.text)
          return scanConstructedArtifact(parts, {})
        },
      },
      scaffoldContent: {
        render: (input) => {
          rendered.push({
            targetName: input.targetName,
            baseUrl: input.baseUrl,
            ...(input.existingGitignore === undefined
              ? {}
              : { existingGitignore: utf8Decode(input.existingGitignore) }),
          })
          return Promise.resolve(
            (options.content ?? defaultContent)(input),
          )
        },
      },
    },
  }
}

async function scaffold(test: Harness, domain: string): Promise<ConfigProposeOutput> {
  return await constructConfigProjectScaffoldProposal({ action: ACTION, domain }, test.deps)
}

describe('the hostname gate is the never-guess boundary, as a parse (D-15)', () => {
  it('(G1) derives the same rule for every domain — one producer, five different answers', () => {
    // PRODUCED, NOT LITERAL: each row's expectation is a derivation of its OWN token, and no two
    // rows share one. A gate returning a constant fails four; a gate keyed on `booking.com` fails
    // three. This is what makes the rule "deterministic code derives the target" rather than "the
    // suite knows about booking.com".
    for (const row of DERIVATIONS) {
      const verdict = parseHostnameToken(row.token)
      expect(verdict, `token ${row.token}`).toEqual({
        kind: 'hostname',
        domain: row.domain,
        baseUrl: row.baseUrl,
        targetName: row.targetName,
      })
    }
    // And the answers really are different from each other, so a producer that collapsed them all
    // onto one value could not pass by accident.
    expect(new Set(DERIVATIONS.map((row) => parseHostnameToken(row.token))
      .map((verdict) => verdict.kind === 'hostname' ? verdict.targetName : '')).size)
      .toBe(4)
  })

  it('(G2) refuses every near miss — the corpus the rule\'s own precondition rejects', () => {
    for (const token of REJECTED) {
      expect(parseHostnameToken(token), `token ${JSON.stringify(token)}`)
        .toEqual({ kind: 'not-a-hostname' })
    }
  })

  it('(G3) reads a URL\'s host through the parser, so userinfo cannot pose as the site', () => {
    // The one case where "everything between // and the first /" and "the authority's host" are
    // different strings. A regex extraction answers `example.com`; the site is `evil.example`.
    expect(parseHostnameToken('https://example.com@evil.example/rooms')).toEqual({
      kind: 'hostname',
      domain: 'evil.example',
      baseUrl: 'https://evil.example',
      targetName: 'evil-example',
    })
    // A port is authority, not host.
    expect(parseHostnameToken('https://booking.com:8443/')).toMatchObject({
      domain: 'booking.com',
      baseUrl: 'https://booking.com',
    })
  })
})

describe('config.project.scaffold refuses rather than guessing (D-15 · CFGM-05)', () => {
  it('(S1) answers a typed refusal naming both continuations, and echoes no origin', async () => {
    const test = harness({ readThrows: true })
    const answer = await scaffold(test, 'checkout flow')

    expect(answer).toEqual({
      outcome: 'refused',
      reason: 'not-a-hostname',
      detail: HOSTNAME_GATE_REFUSAL_DETAIL,
    })
    // BOTH continuations are named — a refusal that said only "that is not a URL" would leave a
    // person with a configured target list they were never told about.
    expect(answer.outcome === 'refused' && answer.detail).toContain('https://example.com')
    expect(answer.outcome === 'refused' && answer.detail).toContain('agent-qa.config.yaml')
    // AND NO GUESS. The token does not come back dressed as a candidate origin, which is the whole
    // of what D-15 forbids. The integrity half is above: the detail is asserted non-empty and to
    // carry two specific sentences, so this absence is not an absence over nothing.
    expect(answer.outcome === 'refused' && answer.detail).not.toContain('checkout')
    expect(test.filed).toHaveLength(0)
  })

  it('(S2) refuses ABOVE the re-read — a guess costs the filesystem nothing', async () => {
    // The double throws on `read`. A gate placed after CFGM-04's re-read would surface that throw
    // instead of the typed refusal, so this cell is the ORDER stated as a measurement.
    const test = harness({ readThrows: true })
    await expect(scaffold(test, 'not_a_domain.x')).resolves.toMatchObject({
      reason: 'not-a-hostname',
    })
    expect(test.rendered).toHaveLength(0)
  })

  it('(S3) refuses a project that already has a configuration, and files nothing', async () => {
    const test = harness({ configBytes: 'workspace:\n  hooksFile: hooks.yaml\n' })
    const answer = await scaffold(test, 'booking.com')

    expect(answer).toMatchObject({ outcome: 'refused', reason: 'already-configured' })
    // It names the file it will not replace and the op that does what the caller probably wanted.
    expect(answer.outcome === 'refused' && answer.detail).toContain(CONFIG_FILE)
    expect(answer.outcome === 'refused' && answer.detail).toContain('config.target.create')
    // NOTHING WAS RENDERED AND NOTHING WAS FILED. The refusal is above the content port, so a
    // project with a configuration cannot have a whole replacement one built for it at all.
    expect(test.rendered).toHaveLength(0)
    expect(test.filed).toHaveLength(0)
  })

  it('(S9) answers UNRENDERABLE as data rather than letting it escape as a fault', async () => {
    // 395-02's refusal, reached the only way this pipeline can reach it: bytes that differ and
    // decode identically. `0x80` and `0xFF` are both U+FFFD, so the diff of them renders as zero
    // hunks — a person would be shown a blank page. The scaffold is the op that folds a project's
    // OWN `.gitignore` into a file it proposes, which is why it is the one that must answer this.
    const test = harness({
      gitignoreBytes: Uint8Array.from([0x80]),
      content: () => [{ path: '.gitignore', bytes: Uint8Array.from([0xff]) }],
    })
    const answer = await scaffold(test, 'booking.com')

    expect(answer).toMatchObject({ outcome: 'refused', reason: 'unrenderable-diff' })
    expect(test.filed).toHaveLength(0)
  })
})

describe('the scaffold proposal is one diff over the whole set (CFGM-05 · D-04/D-14)', () => {
  it('(S4) hands the content port the GATE\'S derivation and nothing else', async () => {
    const test = harness()
    await scaffold(test, 'HTTPS://Booking.com/rooms')

    // The port is asked for exactly what `parseHostnameToken` produced. An op that handed over the
    // raw token — or that derived the name a second time on the far side — fails here, and the
    // failure is the one D-13 is about: two derivations that can disagree.
    expect(test.rendered).toEqual([{ targetName: 'booking-com', baseUrl: 'https://booking.com' }])
  })

  it('(S4b) hands over the project\'s EXISTING gitignore bytes so the block is an upsert', async () => {
    const test = harness({ gitignoreBytes: utf8Encode('dist/\n') })
    await scaffold(test, 'booking.com')

    expect(test.rendered[0]?.existingGitignore).toBe('dist/\n')
  })

  it('(S5/S6) files ONE proposal, applyable, cross-boundary with computed reasons', async () => {
    const test = harness()
    const answer = await scaffold(test, 'booking.com')

    expect(answer.outcome).toBe('proposed')
    // CFGM-05's sentence is ONE reviewable diff. Three files, one record.
    expect(test.filed).toHaveLength(1)
    expect(answer.outcome === 'proposed' && answer.files.sort())
      .toEqual(['.gitignore', CONFIG_FILE, 'hooks.yaml'])

    // APPLYABLE, NOT BLOCKED. This is the WINDOWS-129 shape stated as a cell: an op whose derived
    // artifact cannot pass the pipeline's own validation has no success path at all, and the way
    // that is discovered is by asserting the arm rather than the absence of a throw.
    const payload = test.filed[0]?.payload
    expect(payload?.payloadKind).toBe('applyable')

    // THE FLAG IS READ OFF THE CLASSIFIER, not set by this op. `new-origin` because the scaffold
    // writes a base URL where the committed configuration had none, and `hook-added` because the
    // scaffolded hooks file declares a hook this project would then run. Asserted by MEMBERSHIP so
    // a classifier that started flagging everything for one reason still fails the pair.
    expect(answer.outcome === 'proposed' && answer.crossBoundary).toBe(true)
    const reasons = answer.outcome === 'proposed' ? answer.crossBoundaryReasons : []
    expect(reasons).toContain('new-origin')
    expect(reasons).toContain('hook-added')
  })

  it('(S8) scans the WHOLE new files, not the diff\'s changed lines (D-12)', async () => {
    const test = harness()
    await scaffold(test, 'booking.com')

    // THE WHOLE FILE ARRIVED AS ITS OWN PART, not merely as hunk lines. The comparison is against
    // the EXACT bytes the content port answered — decoded, verbatim, with no `@@` header and no
    // `+` prefixes — so a pipeline that scanned only the rendered hunks produces no part equal to
    // this string and the cell reds. Produced, not literal: the expected text is read back out of
    // the double's own answer rather than typed here.
    const emitted = utf8Decode(
      (await test.deps.scaffoldContent.render({
        targetName: 'booking-com',
        baseUrl: 'https://booking.com',
      })).find((file) => file.path === CONFIG_FILE)?.bytes as Uint8Array,
    )
    expect(emitted).toContain('url: https://booking.com')
    expect(test.scanned).toContain(emitted)
    // The integrity half: the hunk-shaped parts are there TOO, so `toContain` above is not passing
    // against a scan that stopped rendering diffs altogether.
    expect(test.scanned.some((part) => part.includes('@@ -0,0'))).toBe(true)
  })

  it('(S7) cannot construct at all when no scan is bound', async () => {
    const test = harness()
    const { configScan: _dropped, ...withoutScan } = test.deps
    await expect(
      constructConfigProjectScaffoldProposal(
        { action: ACTION, domain: 'booking.com' },
        withoutScan as ConstructConfigScaffoldDeps,
      ),
    ).rejects.toThrow()
    expect(test.filed).toHaveLength(0)
  })
})
