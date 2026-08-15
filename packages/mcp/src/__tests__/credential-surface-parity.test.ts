// ONE FIXTURE, TWO SHIPPED ARTEFACTS, ONE ANSWER (395-26 · T-395-R5-10 / T-395-R5-04).
//
// WHAT THE SECURITY AUDITOR MEASURED, and why a single-surface cell could not see it. The product
// has ONE credential predicate and TWO render channels that ship it — `agent-qa config show` on a
// person's terminal and `agent_qa_get_config` into a model's context. Driven over the same planted
// config, the two channels gave OPPOSITE answers in BOTH directions:
//
//   • MCP returned a credential VERBATIM that the CLI redacted — a string the auth redactor merely
//     TOUCHED took `maskSensitive`'s early return at `agent-qa-server.ts:376` and never reached the
//     credential predicate at all (T-395-R5-10).
//   • The CLI printed three credentials that MCP redacted — `isCredentialEntry` asked its name
//     question of the FINAL path segment only, so a credential under a credential-named ANCESTOR
//     (`plugins.myplugin.credentials.pass`, `credentials[0].pass`, `registry.llms[0].apiKey.value`)
//     rendered at exit 0 (T-395-R5-04).
//
// Both mitigations had already shipped with a passing zero-occurrence assertion beside them. Each
// of those assertions lived on ONE surface, so neither could see the other surface's answer, and
// one-sided hardening is the shape this arc has now filed six times (388/390/392). This file is the
// two-sided pin: ONE seeded directory, BOTH built artefacts spawned from it, and the leak claim
// asserted as a RELATION between the two readings rather than as two independent claims.
//
// AND EVERY PLANT IS PROVEN RENDERABLE BEFORE ITS ABSENCE IS CLAIMED. (P0) below records the
// non-vacuity gate: each opaque sentinel is asserted NON-credential-shaped (so the value arm cannot
// supply the pass the ancestor arm is supposed to give), the auth-mix token is asserted
// credential-shaped, and the auth redactor is asserted to really alter the `notes` string AND to
// alter its own output again — the non-idempotence is the mechanism that fires the early return, so
// a cell that did not pin it would be drawn from inside the assumption it means to test.
//
// WHAT MAKES EACH CELL RED:
//
//  (P0) the plants          — a sentinel that is credential-SHAPED (the ancestor arm would then be
//                             untested, the value arm carrying the cell), or a redactor that no
//                             longer alters `notes` (the MCP arm would then measure nothing).
//  (P1) the leak matrix     — either half of 395-26 removed. Drop the ancestor arm and the CLI
//                             counts go non-zero; restore the early return and the MCP count for
//                             the auth-mix plant goes non-zero. The two red sets are DISJOINT,
//                             which is what proves the halves independent.
//  (P2) discrimination      — over-redaction (T-395-R5-05 / T-395-R5-12). A sibling OUTSIDE the
//                             credential-named container, and the credential-free members of the
//                             llms element, must render verbatim on both surfaces; the CLI must
//                             still LIST the redacted rows by key; the MCP object must not be
//                             wholesale opaque.
//  (P3) the container rule  — the DECIDED answer for a non-credential sibling INSIDE a
//                             credential-named container: it is redacted, on both surfaces. The
//                             ancestor arm makes the CLI agree with the container discipline the
//                             MCP masker has had since 395-25; this cell pins that agreement in
//                             writing instead of leaving it to be discovered by a later failure.

import { execFile } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { isCredentialEntry } from '@vostride/agent-qa-agent'
import { redactAuthStateValue } from '@vostride/agent-qa-core'
import { beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

/** The two artefacts that actually ship. Neither is the `src` this file compiles beside. */
const BUILT_MCP_ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url))
const BUILT_CLI_ENTRY = fileURLToPath(new URL('../../../cli/dist/cli.js', import.meta.url))

const BUILD_HINT = 'run `pnpm --filter @vostride/agent-qa-schema build && pnpm --filter @vostride/agent-qa-agent build && pnpm --filter agent-qa build && pnpm --filter @vostride/agent-qa-mcp build` first'

/** The marker BOTH surfaces print. Its absence from an artefact means the dist predates 395-20. */
const REDACTION_MARKER = '<redacted>'

// ---------------------------------------------------------------------------------------------
// THE PLANTS. Four leak plants plus the container-sibling plant (P3) pins.
// ---------------------------------------------------------------------------------------------

/**
 * PLANT 1 — the auth-mix string (T-395-R5-10). Credential-SHAPED on purpose: it sits under the key
 * `notes`, where no name arm can fire, so only the value arm can catch it — and the defect is
 * precisely that the auth redactor's early return prevents the value arm from ever being asked.
 * The `storageStatePath=` token is what makes the redactor touch the string.
 */
const AUTH_MIX_TOKEN = 'sk-ant-api03-395twentysixAUTHMIXFIXTUREONLYnotarealkeyQQ'
const AUTH_MIX_NOTES = `operator note: storageStatePath=/var/tmp/agent-qa-auth-state.json and the provider key is ${AUTH_MIX_TOKEN}`

/**
 * PLANTS 2-4 — the ancestor plants (T-395-R5-04). OPAQUE, and that is load-bearing: a
 * provider-prefixed token here would be cleared by the value-shape arm and the cell would pass
 * without the ancestor arm existing. (P0) asserts each one is non-credential-shaped.
 */
/** A plain nested OBJECT under a credential-named key — no array anywhere. The CLASS, not the instance. */
const OBJECT_ANCESTOR_SENTINEL = 'tealwood-7412-delta-fixtureonly'
/** An object ELEMENT of a credential-named array — the instance round 5 closed. */
const ARRAY_ANCESTOR_SENTINEL = 'marigold-5510-sierra-fixtureonly'
/** An object under a credential-named key inside an array — the register's own named component. */
const NESTED_ANCESTOR_SENTINEL = 'canterbury-3298-lima-fixtureonly'

/**
 * PLANT 5 — the container sibling (395-26 · W3). A NON-credential key inside a credential-named
 * container. Today the CLI prints it; after the ancestor arm it is redacted, matching the container
 * discipline the MCP masker has had since 395-25. (P3) pins that decided answer.
 */
const CONTAINER_SIBLING_SENTINEL = 'orchardgate-6021-echo-fixtureonly'

/** The discrimination controls: values that must survive verbatim on BOTH surfaces. */
const OUTSIDE_SIBLING_ENDPOINT = 'https://plugins.example.com/parity-endpoint-6604'
const LLM_NAME = 'primary-parity-fixture'
const LLM_MODEL = 'gpt-5.6-terra'
const LLM_DOCS_URL = 'https://docs.example.com/parity-1174'

const FIXTURE_CONFIG = `version: 1
notes: "${AUTH_MIX_NOTES}"
credentials:
  - username: ${CONTAINER_SIBLING_SENTINEL}
    pass: ${ARRAY_ANCESTOR_SENTINEL}
plugins:
  myplugin:
    endpoint: ${OUTSIDE_SIBLING_ENDPOINT}
    credentials:
      pass: ${OBJECT_ANCESTOR_SENTINEL}
registry:
  llms:
    - name: ${LLM_NAME}
      provider: openai-compatible
      model: ${LLM_MODEL}
      docsUrl: ${LLM_DOCS_URL}
      apiKey:
        value: ${NESTED_ANCESTOR_SENTINEL}
`

const MCP_DRIVER = `import { createAgentQaMcpServer } from ${JSON.stringify(BUILT_MCP_ENTRY)}
const server = createAgentQaMcpServer({
  configPath: process.argv[2],
  analyticsConfig: { analytics: { privacy: true } },
})
const result = await server._registeredTools.agent_qa_get_config.handler({}, {})
process.stdout.write(JSON.stringify(result))
`

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * A dist that exists is not a dist that is current. Both guards name the exact build command, and
 * both grep the artefact for the marker every credential render in this product prints — an
 * artefact without it predates the one-predicate work entirely and would measure the wrong bytes.
 */
function assertArtefact(path: string, label: string): void {
  expect(existsSync(path), `${label} is not built — ${BUILD_HINT} (${path})`).toBe(true)
  expect(
    readFileSync(path, 'utf-8').includes(REDACTION_MARKER),
    `${label} carries no \`${REDACTION_MARKER}\` marker, so it predates the credential render work — ${BUILD_HINT} (${path})`,
  ).toBe(true)
}

interface SurfaceReading {
  /** The whole combined stdout+stderr of the shipped `agent-qa config show`. */
  cli: string
  /** The CLI's exit status — the leak must be measured at whatever code the person actually gets. */
  cliStatus: number | null
  /** Every content block of the MCP tool response, joined — the bytes that land in a model's context. */
  mcp: string
  /** The parsed tool payload, for the not-wholesale-opaque control. */
  mcpPayload: { raw?: unknown }
}

let reading: SurfaceReading

/**
 * ONE seeded directory, BOTH artefacts spawned from it. The relation this file asserts only means
 * anything if the two readings come from the same bytes on disk, so they are taken here together
 * and never separately.
 */
async function readBothSurfaces(): Promise<SurfaceReading> {
  assertArtefact(BUILT_MCP_ENTRY, 'the MCP server dist')
  assertArtefact(BUILT_CLI_ENTRY, 'the CLI dist')

  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-parity-'))
  try {
    const configPath = join(dir, 'agent-qa.config.yaml')
    const driverPath = join(dir, 'drive.mjs')
    await writeFile(configPath, FIXTURE_CONFIG, 'utf-8')
    await writeFile(driverPath, MCP_DRIVER, 'utf-8')

    const cliRun = spawnSync(process.execPath, [BUILT_CLI_ENTRY, 'config', 'show'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      maxBuffer: 16 * 1024 * 1024,
    })

    const { stdout } = await execFileAsync(process.execPath, [driverPath, configPath], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024,
    })
    const payload = JSON.parse(stdout) as { content: Array<{ text?: string }>; raw?: unknown }

    return {
      cli: `${cliRun.stdout ?? ''}${cliRun.stderr ?? ''}`,
      cliStatus: cliRun.status,
      mcp: payload.content.map(block => block.text ?? '').join('\n'),
      mcpPayload: payload,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  reading = await readBothSurfaces()
}, 120_000)

describe('one credential answer on every shipped render channel (395-26)', () => {
  it('(P0) the plants are what the matrix says they are — the non-vacuity gate', () => {
    // EVERY SENTINEL IS REALLY IN THE FILE. A fixture that lost a plant would seed a clean config
    // and the leak cell would pass for the wrong reason (the 395-24 trap: a sentinel the surface
    // never had a chance to print).
    for (const plant of [
      AUTH_MIX_TOKEN,
      OBJECT_ANCESTOR_SENTINEL,
      ARRAY_ANCESTOR_SENTINEL,
      NESTED_ANCESTOR_SENTINEL,
      CONTAINER_SIBLING_SENTINEL,
    ]) {
      expect(occurrences(FIXTURE_CONFIG, plant), `the plant \`${plant}\` is not in the fixture`).toBe(1)
    }

    // THE THREE ANCESTOR PLANTS CARRY NO CREDENTIAL SHAPE. This is the whole reason they can test
    // the NAME question: if the value arm could clear them, the cell would go green with the
    // ancestor arm deleted.
    for (const opaque of [
      OBJECT_ANCESTOR_SENTINEL,
      ARRAY_ANCESTOR_SENTINEL,
      NESTED_ANCESTOR_SENTINEL,
      CONTAINER_SIBLING_SENTINEL,
    ]) {
      expect(
        isCredentialEntry('someOrdinaryKey', opaque),
        `\`${opaque}\` is credential-SHAPED, so the value arm — not the ancestor arm — would be carrying this cell`,
      ).toBe(false)
    }

    // AND THE AUTH-MIX TOKEN DOES. Under `notes` no name arm can fire, so the value arm is the only
    // mechanism that can catch it; if it could not, the MCP arm would be measuring nothing.
    expect(
      isCredentialEntry('someOrdinaryKey', AUTH_MIX_NOTES),
      'the auth-mix string must be credential-shaped or the value arm has nothing to catch',
    ).toBe(true)

    // THE DEFECT'S OWN ROAD IS OPEN — 384 round 4's law. `maskSensitive` returns early only when
    // the auth redactor CHANGED the string, so if the redactor left `notes` alone the early return
    // would never be taken and this whole MCP arm would be a cell drawn from inside its own
    // assumption.
    const once = redactAuthStateValue(AUTH_MIX_NOTES)
    expect(
      once,
      'the auth redactor does not touch the `notes` plant, so `maskSensitive`\'s early return is never taken and the MCP arm measures nothing',
    ).not.toBe(AUTH_MIX_NOTES)
    // AND IT IS NOT IDEMPOTENT, which is the mechanism at the leaf. The masker's root pass redacts
    // the whole tree first, so by the time the walk reaches `notes` the string is already
    // once-redacted; the early return fires there only because a SECOND pass changes it again.
    expect(
      redactAuthStateValue(once),
      'the redactor is idempotent on the plant, so the leaf-level early return would not fire — re-shape the plant',
    ).not.toBe(once)
    // AND THE CREDENTIAL SURVIVES BOTH PASSES. The redactor is not a credential redactor; that is
    // the entire point of asking the credential question above it.
    expect(occurrences(redactAuthStateValue(once), AUTH_MIX_TOKEN), 'the auth redactor removed the credential by itself').toBe(1)
  })

  it('(P1) the cross-surface leak matrix — every plant counts ZERO on BOTH shipped artefacts', () => {
    // THE RELATION, NOT TWO CLAIMS. Both counts are read from the same seeded directory in the same
    // cell, so a fix that closes one direction and leaves the other open reds HERE — which is the
    // one-sided-hardening shape this arc has filed six times.
    const plants: Array<[string, string]> = [
      ['notes (auth-redactor mix)', AUTH_MIX_TOKEN],
      ['plugins.myplugin.credentials.pass (object ancestor)', OBJECT_ANCESTOR_SENTINEL],
      ['credentials[0].pass (array ancestor)', ARRAY_ANCESTOR_SENTINEL],
      ['registry.llms[0].apiKey.value (object under a credential key in an array)', NESTED_ANCESTOR_SENTINEL],
    ]

    for (const [where, plant] of plants) {
      expect(
        occurrences(reading.cli, plant),
        `\`config show\` printed the credential at ${where}:\n\n${reading.cli}`,
      ).toBe(0)
      expect(
        occurrences(reading.mcp, plant),
        `\`agent_qa_get_config\` returned the credential at ${where} into a model's context:\n\n${reading.mcp}`,
      ).toBe(0)
    }

    // THE LEAK IS MEASURED AT THE EXIT CODE A PERSON ACTUALLY GETS. `config show` over a healthy
    // file succeeds; a guard that closed the leak by failing the command would be a different
    // product, not a fixed one.
    expect(reading.cliStatus, `config show did not succeed:\n\n${reading.cli}`).toBe(0)
  })

  it('(P2) discrimination — redaction lands on credentials, not on the config (T-395-R5-05 / R5-12)', () => {
    // A SIBLING OUTSIDE THE CREDENTIAL-NAMED CONTAINER IS UNTOUCHED, on both surfaces. Over-redaction
    // is a real cost: it takes from the person the command they ran, and from the model the config
    // it was asked to read.
    expect(occurrences(reading.cli, OUTSIDE_SIBLING_ENDPOINT), `config show hid the plugin endpoint:\n\n${reading.cli}`)
      .toBeGreaterThanOrEqual(1)
    expect(occurrences(reading.mcp, OUTSIDE_SIBLING_ENDPOINT), `the tool hid the plugin endpoint:\n\n${reading.mcp}`)
      .toBeGreaterThanOrEqual(1)

    // THE CREDENTIAL-FREE MEMBERS OF THE llms ELEMENT survive on both surfaces — the container is
    // not blackened wholesale because one of its members is a credential.
    for (const readable of [LLM_NAME, LLM_MODEL, LLM_DOCS_URL]) {
      expect(occurrences(reading.cli, readable), `config show hid \`${readable}\`:\n\n${reading.cli}`)
        .toBeGreaterThanOrEqual(1)
      expect(occurrences(reading.mcp, readable), `the tool hid \`${readable}\`:\n\n${reading.mcp}`)
        .toBeGreaterThanOrEqual(1)
    }

    // THE ROWS ARE MARKED, NOT DROPPED. `config show`'s whole job is saying which keys resolve from
    // where; a redaction that deleted the row would answer a different question.
    for (const key of [
      'credentials[0].pass',
      'plugins.myplugin.credentials.pass',
      'registry.llms[0].apiKey.value',
      'notes',
    ]) {
      expect(occurrences(reading.cli, key), `config show dropped the row \`${key}\`:\n\n${reading.cli}`)
        .toBeGreaterThanOrEqual(1)
    }
    expect(occurrences(reading.cli, REDACTION_MARKER), `config show marked nothing:\n\n${reading.cli}`)
      .toBeGreaterThanOrEqual(1)

    // AND THE TOOL RESPONSE IS NOT WHOLESALE OPAQUE. 395-25 measured and rejected the shape where
    // asking the full predicate at every node rendered the entire `raw` config as one marker — the
    // model then cannot read the config it was asked about.
    const raw = (reading.mcpPayload as { raw?: unknown }).raw
      ?? (JSON.parse(reading.mcp) as { raw?: unknown }).raw
    expect(typeof raw, `the tool rendered the whole config as one value:\n\n${reading.mcp}`).toBe('object')
    expect(raw, 'the tool rendered the whole config as one marker').not.toBe(REDACTION_MARKER)
    expect(occurrences(reading.mcp, '"version"'), `the tool dropped ordinary members:\n\n${reading.mcp}`)
      .toBeGreaterThanOrEqual(1)
  })

  it('(P3) a non-credential sibling INSIDE a credential-named container is redacted on BOTH surfaces', () => {
    // THE DECIDED ANSWER, WRITTEN DOWN (395-26 · W3). `credentials[0].username` is not itself a
    // credential, and today the CLI prints it while MCP — which redacts a credential-named
    // container whole — does not. The ancestor arm makes the CLI agree with the MCP discipline,
    // and that agreement is the point of this plan: ONE question, ONE answer, on every channel.
    // The alternative (leaf-name-only, container members verbatim) would keep the two surfaces
    // disagreeing about the same bytes, which is the defect, not a preference.
    expect(
      occurrences(reading.cli, CONTAINER_SIBLING_SENTINEL),
      `config show printed a member of a credential-named container verbatim:\n\n${reading.cli}`,
    ).toBe(0)
    expect(
      occurrences(reading.mcp, CONTAINER_SIBLING_SENTINEL),
      `the tool returned a member of a credential-named container verbatim:\n\n${reading.mcp}`,
    ).toBe(0)

    // AND THE BOUND ON IT: the rule is CONTAINMENT, not proximity. The plugin endpoint sits one key
    // away from `plugins.myplugin.credentials` and stays verbatim — asserted in (P2), restated here
    // as the scope of this decision.
    expect(occurrences(reading.cli, OUTSIDE_SIBLING_ENDPOINT)).toBeGreaterThanOrEqual(1)
  })
})
