// THE FURTHEST-TRAVELLING RENDER CHANNEL, MEASURED ON THE BUILT ARTEFACT (395-25 · F-06/CR-02).
//
// `agent_qa_get_config` returns a JSON render of the config into a MODEL's context, which is then
// sent to whichever provider serves the turn. These cells therefore drive `packages/mcp/dist/index.js`
// — the artefact that actually ships — in a child process, not the in-process `src` barrel the rest
// of this suite uses. A masking claim measured against source while the dist is stale is a claim
// about a file nobody runs.

import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const BUILT_MCP_ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url))

/** Planted credentials. Each is a fixture value; none is a real key. */
const SCALAR_TOKEN = 'sk-ant-api03-395twentyfiveSCALARTOKENFIXTUREONLYnotarealZQ7X'
/** The last four characters of SCALAR_TOKEN — what the deleted partial mask used to disclose. */
const SCALAR_TAIL_SENTINEL = 'ZQ7X'
const URL_USERINFO_TOKEN = 'sk-ant-api03-395twentyfiveURLUSERINFOFIXTUREONLYnotarealkey'
const HEADER_AUTH_TOKEN = 'sk-ant-api03-395twentyfiveHEADERAUTHFIXTUREONLYnotarealkey'

const FIXTURE_CONFIG = `version: 1
registry:
  llms:
    - name: primary-masking-fixture
      provider: openai-compatible
      model: gpt-5.6-terra
      apiToken: ${SCALAR_TOKEN}
      baseURL: https://user:${URL_USERINFO_TOKEN}@api.example.com
      providerHeaders:
        X-Client-Auth: ${HEADER_AUTH_TOKEN}
`

const DRIVER = `import { createAgentQaMcpServer } from ${JSON.stringify(BUILT_MCP_ENTRY)}
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
 * Drive the SHIPPED `agent_qa_get_config` and return the whole text a client receives — every
 * content block joined, exactly the bytes that land in the model's context.
 */
async function renderConfigToolText(): Promise<string> {
  expect(
    existsSync(BUILT_MCP_ENTRY),
    `these cells measure the built artefact; run \`pnpm --filter @vostride/agent-qa-mcp build\` first (${BUILT_MCP_ENTRY})`,
  ).toBe(true)

  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-mcp-masking-'))
  try {
    const configPath = join(dir, 'agent-qa.config.yaml')
    const driverPath = join(dir, 'drive.mjs')
    await writeFile(configPath, FIXTURE_CONFIG, 'utf-8')
    await writeFile(driverPath, DRIVER, 'utf-8')

    const { stdout } = await execFileAsync(process.execPath, [driverPath, configPath], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024,
    })
    const payload = JSON.parse(stdout) as { content: Array<{ text?: string }> }
    return payload.content.map(block => block.text ?? '').join('\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('agent_qa_get_config credential masking on the built dist', () => {
  it('(M1) returns ZERO bytes of any planted credential, including the old partial mask tail', async () => {
    const text = await renderConfigToolText()

    expect(occurrences(text, URL_USERINFO_TOKEN), `the tool returned the URL-userinfo credential:\n\n${text}`).toBe(0)
    expect(occurrences(text, HEADER_AUTH_TOKEN), `the tool returned the X-Client-Auth credential:\n\n${text}`).toBe(0)
    expect(occurrences(text, SCALAR_TOKEN), `the tool returned the scalar apiToken:\n\n${text}`).toBe(0)
    // The partial mask disclosed `slice(0,3)` + `slice(-4)`. A disclosure budget nobody set is
    // still a disclosure: the tail must be gone, not shortened.
    expect(
      occurrences(text, SCALAR_TAIL_SENTINEL),
      `the tool disclosed the apiToken's tail — the partial mask is still live:\n\n${text}`,
    ).toBe(0)
    expect(occurrences(text, '<redacted>'), `nothing was redacted:\n\n${text}`).toBe(3)
  })

  it('(M2) leaves the credential-free members of the same container verbatim', async () => {
    const text = await renderConfigToolText()

    // Over-redaction is a real cost: a blackened `registry.llms` would hide from the model the
    // very config it was asked to read. Redaction lands on the entries, not on the container.
    expect(text).toContain('primary-masking-fixture')
    expect(text).toContain('openai-compatible')
    expect(text).toContain('gpt-5.6-terra')
    expect(text).toContain('"baseURL"')
    expect(text).toContain('"X-Client-Auth"')
  })
})
