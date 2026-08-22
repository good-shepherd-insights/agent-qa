// The in-process run fixture (Phase 401 plan 11).
//
// NOT A TEST FILE: vitest's include here is `src/**/__tests__/**/*.test.ts`, so this module is
// imported, never collected.
//
// IT BUILDS ON `commands/__tests__/suite-run-fixture.ts` RATHER THAN BESIDE IT. That helper already
// owns the two things every gate cell in this phase needs — `CountingTarget` (the loopback target
// that records who knocked, which is how "the gate decided before anything touched the target"
// stops being a proxy measurement) and the artifact readers over a project's own `.agent-qa`. A
// second copy would be a second answer to what a denial's five artifacts are.
//
// WHAT THIS ADDS is a project whose shape the in-process cells need and the suite fixture does not:
// a standalone TEST file as well as a suite, an `environment` declaration that varies per call
// (the single axis the denial control turns), and the ability to omit a required file so an input
// refusal has something real to refuse.
//
// THE MODEL POINTS AT AN UNBINDABLE PORT (1), inherited deliberately: the run STARTS, plans, fails
// to reach the model and finishes. If the model shared the counting server, a planner retry would
// land in `hits` and the "nobody knocked" assertion would be measuring the planner instead of the
// run-start probe.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'

export {
  CountingTarget,
  auditRows,
  buildOrdinalsExist,
  eventTypes,
  runDirs,
} from '../../commands/__tests__/suite-run-fixture.js'
export type { AuditRow, FixtureEnvironment } from '../../commands/__tests__/suite-run-fixture.js'

export interface InProcessFixture {
  /** The project directory, real-pathed (macOS `/var` → `/private/var`). */
  readonly project: string
  /** The absolute config path a door hands the producer. */
  readonly configPath: string
  /** `<configDir>/.agent-qa` — the root the evidence check reads (Pitfall 5). */
  readonly agentQaRoot: string
  /** The workspace-relative path of the standalone test file. */
  readonly testPattern: string
  /** The workspace-relative path of the suite file. */
  readonly suitePattern: string
  /** The suite member's own test id, so a cell can assert the MEMBER ran. */
  readonly memberTestId: string
  /** The standalone test's id. */
  readonly directTestId: string
}

export interface InProcessFixtureInput {
  readonly origin: string
  /** `undefined` writes NO declaration at all — which is the undeclared case (D-06). */
  readonly environment?: 'local' | 'shared' | undefined
  /** Omit the env file, so the input preflight has a real refusal to make. */
  readonly omitEnvFile?: boolean
  /** Omit the hooks file. */
  readonly omitHooksFile?: boolean
  /** Omit the secrets file. */
  readonly omitSecretsFile?: boolean
  /** Write a test file that parses to ZERO runnable tests (the RUNX-06 door). */
  readonly emptyTestFile?: boolean
}

/**
 * Write a project with one target, one standalone test and one suite over its own member.
 *
 * Every knob above changes EXACTLY ONE thing, which is what lets a denial cell and its allow
 * control differ in one field and nothing else.
 */
export function createInProcessFixture(input: InProcessFixtureInput): InProcessFixture {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'in-process-run-')))
  mkdirSync(join(project, 'tests'), { recursive: true })
  mkdirSync(join(project, 'suites'), { recursive: true })

  const directTestId = generateTestId()
  const memberTestId = generateTestId()

  writeFileSync(
    join(project, 'agent-qa.config.yaml'),
    [
      'workspace:',
      '  testMatch:',
      "    - 'tests/**/*.yaml'",
      '  suiteMatch:',
      "    - 'suites/**/*.suite.yaml'",
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'registry:',
      '  targets:',
      '    in-process-thing:',
      '      platform: web',
      `      url: ${input.origin}/in-process-thing`,
      ...(input.environment === undefined ? [] : [`      environment: ${input.environment}`]),
      '  llms:',
      '    - name: unreachable',
      '      provider: openai-compatible',
      '      model: gpt-4o-mini',
      '      baseURL: http://127.0.0.1:1/v1',
      'use:',
      '  llm: unreachable',
      '  mobile:',
      '    appState: preserve',
      '',
    ].join('\n'),
  )
  if (input.omitHooksFile !== true) writeFileSync(join(project, 'hooks.yaml'), 'hooks: []\n')
  if (input.omitEnvFile !== true) writeFileSync(join(project, '.env'), '')
  if (input.omitSecretsFile !== true) writeFileSync(join(project, '.env.secrets.local'), '')

  writeFileSync(
    join(project, 'tests', 'direct.yaml'),
    input.emptyTestFile === true
      ? '# a file that parses to zero runnable tests\n'
      : [
          `test-id: ${directTestId}`,
          'name: the standalone test',
          'target: in-process-thing',
          'steps:',
          '  - Verify the page says "Example"',
          '',
        ].join('\n'),
  )
  writeFileSync(
    join(project, 'tests', 'member.yaml'),
    [
      `test-id: ${memberTestId}`,
      'name: the suite member',
      'target: in-process-thing',
      'steps:',
      '  - Verify the page says "Example"',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(project, 'suites', 'gate.suite.yaml'),
    [
      `suite-id: ${generateSuiteId()}`,
      'name: the in-process suite',
      'target: in-process-thing',
      'tests:',
      '  - test: tests/member.yaml',
      `    id: ${memberTestId}`,
      '',
    ].join('\n'),
  )

  return {
    project,
    configPath: join(project, 'agent-qa.config.yaml'),
    agentQaRoot: join(project, '.agent-qa'),
    testPattern: 'tests/direct.yaml',
    suitePattern: 'suites/gate.suite.yaml',
    memberTestId,
    directTestId,
  }
}
