// The one thing the committed grant ledger is committed FOR: an approval recorded on machine A is
// visible in the pull request and inherited by checkout B (Phase 391, D-11 / PROP-01).
//
// WHY THIS FILE EXISTS. `grants.jsonl` lives at the knowledge root and travels in git, and that is
// the entire sovereignty argument for a committed ledger: a reviewer sees every widening of agent
// autonomy as a diff, the headless daemon inherits the approvals a human granted at a terminal, and
// a revoke is one more committed line. Every one of those claims is false the moment a `.gitignore`
// rule matches the file — and it would be false SILENTLY, because an ignored ledger still reads,
// still folds, and still authorizes on the machine that wrote it. The sibling quarantine ledger
// reconciled its placement in a module docstring; this one is measured.
//
// THE SHAPE OF THE PIN. Both halves run against production artefacts, and neither half is handed
// the other's bytes:
//
//   the rules half   `agent-qa init` really runs and really writes the knowledge `.gitignore`;
//                    `git check-ignore` — git's own answer, not a re-implementation of its
//                    matching — is asked about the real file in a real repository
//   the verifier half `verifyEffectiveGitignore` runs over the SHIPPED probe table, so a future
//                    rule that hid the ledger is refused at `init` rather than discovered later
//   the path half     the ledger path is knowledge-root-relative, so the committed bytes carry no
//                    machine-local prefix and a second checkout resolves them the same way
//
// The negative controls matter as much as the positives: a probe asserting "not ignored" proves
// nothing unless the same machinery reports "ignored" for a rule that really does match, so the
// ledger name is also run against a repository that deliberately ignores it.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { Command } from 'commander'
import { GRANT_LEDGER_FILENAME, grantsLedgerPath } from '@vostride/agent-qa-knowledge-local'
import { afterEach, describe, expect, it } from 'vitest'

import { KNOWLEDGE_GITIGNORE_PROBES, verifyEffectiveGitignore } from '../commands/init-filesystem.js'
import { createInitCommand } from '../commands/init.js'

const KNOWLEDGE_ROOT_DIR = 'agent-qa-knowledge'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'grant-ledger-portability-'))
  roots.push(root)
  return root
}

function initializeGit(root: string): void {
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' })
}

/** git's OWN answer about one path. Never a re-implementation of `.gitignore` matching. */
function gitIgnores(cwd: string, path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(
    `git check-ignore could not decide "${path}": status ${result.status ?? 'null'} ${result.stderr}`,
  )
}

async function runRealInit(dir: string): Promise<void> {
  const parent = new Command()
  parent.addCommand(createInitCommand())
  await parent.parseAsync(['node', 'test', 'init', '--dir', dir, '--platform', 'web', '--skip-install'])
}

describe('the committed grant ledger is commit-visible by default (D-11)', () => {
  it('escapes every rule the tool actually writes into the knowledge .gitignore', async () => {
    const root = tempRoot()
    await runRealInit(root)
    const knowledgeRoot = join(root, KNOWLEDGE_ROOT_DIR)

    // The sovereign case: the knowledge tree as its own repository. A nested repository does not
    // inherit its parent's .gitignore, so only the knowledge root's own rules can decide here.
    initializeGit(knowledgeRoot)
    writeFileSync(grantsLedgerPath(knowledgeRoot), '', 'utf8')

    expect(gitIgnores(knowledgeRoot, GRANT_LEDGER_FILENAME)).toBe(false)

    // THE CONTROL. The line above is a claim about git and about the emitted rules together, and it
    // would read identically if `gitIgnores` were simply broken. A rule that really does match the
    // ledger must come back true through the same call.
    const ignoringRoot = tempRoot()
    initializeGit(ignoringRoot)
    writeFileSync(join(ignoringRoot, '.gitignore'), `${GRANT_LEDGER_FILENAME}\n`, 'utf8')
    writeFileSync(join(ignoringRoot, GRANT_LEDGER_FILENAME), '', 'utf8')
    expect(gitIgnores(ignoringRoot, GRANT_LEDGER_FILENAME)).toBe(true)

    // …and the emitted file really is the one that was consulted: it exists, and none of its rules
    // names the ledger.
    const emitted = readFileSync(join(knowledgeRoot, '.gitignore'), 'utf8')
    expect(emitted).not.toContain(GRANT_LEDGER_FILENAME)
    expect(emitted).toContain('memory/index/')
  }, 120_000)

  it('is a `visible` probe in the shipped table, so init REFUSES a rule that hides it', async () => {
    // Unmatched-by-default and refused-if-matched are different guarantees, and only the second one
    // survives an operator editing their own ignore file.
    const probe = KNOWLEDGE_GITIGNORE_PROBES.find((entry) => entry.path === GRANT_LEDGER_FILENAME)
    expect(probe?.expected).toBe('visible')

    const root = tempRoot()
    initializeGit(root)
    // A knowledge .gitignore that satisfies every functional rule AND hides the ledger.
    const hostileRules = [
      'memory/index/',
      'memory/queue/',
      '.lease',
      '.epoch',
      '**/artifacts/',
      'skills/.staging/',
      '.*.agent-qa-init-*.tmp',
      GRANT_LEDGER_FILENAME,
      '',
    ].join('\n')
    writeFileSync(join(root, '.gitignore'), hostileRules, 'utf8')
    for (const entry of KNOWLEDGE_GITIGNORE_PROBES) {
      const absolute = join(root, entry.path)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, 'fixture\n')
    }

    expect(() =>
      verifyEffectiveGitignore({
        cwd: root,
        label: 'agent-qa-knowledge/.gitignore',
        probes: KNOWLEDGE_GITIGNORE_PROBES,
      }),
    ).toThrow(`"${GRANT_LEDGER_FILENAME}" must remain commit-visible`)

    // And the same table passes on the rules WITHOUT that last line — the refusal is about the
    // ledger rule and not about the fixture tree.
    writeFileSync(
      join(root, '.gitignore'),
      hostileRules.replace(`${GRANT_LEDGER_FILENAME}\n`, ''),
      'utf8',
    )
    expect(
      verifyEffectiveGitignore({
        cwd: root,
        label: 'agent-qa-knowledge/.gitignore',
        probes: KNOWLEDGE_GITIGNORE_PROBES,
      }),
    ).toEqual({ checked: true })
  })

  it('addresses the ledger relative to the knowledge root — the same bytes on any checkout', () => {
    // Checkout portability is a property of the PATH RULE, not of any one machine's paths, so it is
    // measured across two unrelated roots: the segment below the root must be identical, and it
    // must be a single relative name carrying no traversal.
    const rootA = tempRoot()
    const rootB = tempRoot()
    expect(rootA).not.toBe(rootB)

    const relativeA = relative(rootA, grantsLedgerPath(rootA))
    const relativeB = relative(rootB, grantsLedgerPath(rootB))

    expect(relativeA).toBe(relativeB)
    expect(relativeA).toBe(GRANT_LEDGER_FILENAME)
    expect(isAbsolute(relativeA)).toBe(false)
    expect(relativeA).not.toContain('..')
    // Neither root's bytes leak into the other's answer — the failure a committed artifact keyed on
    // machine-local paths actually has (the sibling ledger shipped that bug once).
    expect(grantsLedgerPath(rootA)).not.toContain(rootB)
  })
})
