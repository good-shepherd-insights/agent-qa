// The one-commit apply, against a REAL git repository (394-10, D-06 · WTST-01/WTST-07).
//
// WHY A REAL REPOSITORY AND NOT A MOCKED EXEC. The claim here is about what `git log` says
// afterwards — one commit, one file, the proposal id in the message — and a suite built over a
// scripted exec would pass identically against an implementation that recorded the right argv and
// produced no commit at all. So every cell below runs `git init`, seeds a commit, and reads the
// result back out of git rather than out of the code under test. The injected seam is still used,
// but only where the SUBJECT of the cell is the argv itself or a spawn failure that cannot be
// provoked with a real binary.
//
// THIS IS THE FIRST WRITE THIS PRODUCT MAKES TO A USER'S OWN HISTORY. The properties are therefore
// stated as refusals rather than as behaviours: a dirty target refuses and changes nothing, an
// absent git refuses instead of skipping, a target that moved under the proposal refuses instead of
// overwriting, and the commit carries exactly the one file the apply wrote. Each has its own cell,
// and the ones a plausible wrong implementation would still satisfy have a mutation beside them in
// `scripts/394-apply-mutation.sh`.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  APPLY_GIT_TIMEOUT_MS,
  ApplyCommitHashUnavailableError,
  ApplyProducedNoChangeError,
  ApplyTargetChangedError,
  DirtyApplyTargetError,
  GitUnavailableForApplyError,
  applyTestDraftAsOneCommit,
  captureIndexEntry,
  restoreIndexEntry,
} from '../composition/local-agent-host.js'
import type { GitApplyExec, TestDraftApplyRequest } from '../composition/local-agent-host.js'

const DRAFT_BYTES = `name: The coupon banner appears after a code is applied
target: local-form
steps:
  - Open the cart
  - Apply the coupon FREESHIP
  - Verify the coupon banner is visible
`

const TARGET_PATH = 'tests/coupon-banner.yaml'
const PROPOSAL_ID = 'prop_01J9ZZKQ7X8Q4M6N2R5T3V7W9A'

let root: string
let configPath: string
let draftPath: string

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** The head commit's changed paths, read out of git rather than out of the subject. */
function headStatPaths(): string[] {
  const shown = git('show', '--stat', '--name-only', '--format=', 'HEAD')
  return shown.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

function headMessage(): string {
  return git('log', '-1', '--format=%B', 'HEAD').stdout
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').stdout.trim())
}

/** Every file under the workspace with its bytes — the instrument for "the tree is unchanged". */
function treeSnapshot(dir = root, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === '.git') continue
    const child = join(dir, name.name)
    const key = prefix === '' ? name.name : `${prefix}/${name.name}`
    if (name.isDirectory()) Object.assign(out, treeSnapshot(child, key))
    else out[key] = createHash('sha256').update(readFileSync(child)).digest('hex')
  }
  return out
}

/**
 * Assert a NAMED refusal, and assert the name is a class before believing the throw.
 *
 * `expect(fn).toThrow(SomeClass)` where `SomeClass` is `undefined` degrades to "throws anything",
 * so a refusal cell written that way passes against a module that exports no such class at all —
 * which is exactly the state this file was committed in, and it would have reported four of these
 * cells GREEN with no subject in existence. The `typeof` line is what makes the RED real.
 */
function expectRefusal(fn: () => unknown, ctor: unknown, name: string): void {
  expect(typeof ctor).toBe('function')
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ctor as new (...args: never[]) => Error)
  expect((caught as Error).name).toBe(name)
}

function request(overrides: Partial<TestDraftApplyRequest> = {}): TestDraftApplyRequest {
  return {
    proposalId: PROPOSAL_ID,
    draftPath,
    targetPath: TARGET_PATH,
    summaryLine: 'The coupon banner appears after a code is applied — keep-eligible',
    ...overrides,
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'one-commit-apply-'))
  configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `workspace:
  testMatch:
    - tests/**/*.yaml
`,
  )
  mkdirSync(join(root, 'tests', '.agent-qa-drafts'), { recursive: true })
  draftPath = 'tests/.agent-qa-drafts/deadbeef.yaml'
  writeFileSync(join(root, draftPath), DRAFT_BYTES)

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa apply test')
  git('config', 'user.email', 'apply-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'gpg.format', 'openpgp')
  // The shelf is gitignored in every real project (`agent-qa init` writes the managed block), so a
  // fixture that left it visible would start every cell with a dirty repository — which would make
  // a repo-wide dirty check refuse EVERYTHING and turn the differential that catches one into a
  // suite that reds on all fifteen rows and names nothing.
  writeFileSync(join(root, '.gitignore'), 'tests/.agent-qa-drafts/\n')
  writeFileSync(join(root, 'README.md'), 'seeded\n')
  git('add', '--', '.gitignore', 'README.md', 'agent-qa.config.yaml')
  git('commit', '--quiet', '-m', 'seed')
  // The instrument's own precondition: a clean tree before every cell, so "this file is dirty" is
  // something a cell ARRANGED rather than something the fixture left lying around.
  if (git('status', '--porcelain').stdout.trim() !== '') {
    throw new Error(`the fixture repository is not clean: ${git('status', '--porcelain').stdout}`)
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('applyTestDraftAsOneCommit', () => {
  it('writes the draft to its target and makes exactly ONE commit of exactly ONE file', () => {
    const before = commitCount()
    const result = applyTestDraftAsOneCommit({ configPath, request: request() })

    expect(result.filePath).toBe(TARGET_PATH)
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
    expect(commitCount()).toBe(before + 1)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(result.commit).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('names the proposal id in the commit message, so history says which artifact produced it', () => {
    applyTestDraftAsOneCommit({ configPath, request: request() })
    const message = headMessage()
    expect(message).toContain(PROPOSAL_ID)
    expect(message.toLowerCase()).toContain('agent-qa')
  })

  it('refuses a DIRTY target by name and leaves the working tree byte-unchanged', () => {
    // A human has uncommitted work at exactly the file the agent is about to write.
    writeFileSync(join(root, TARGET_PATH), 'name: mine, not yet committed\nsteps:\n  - Open\n')
    const before = treeSnapshot()
    const commitsBefore = commitCount()

    expectRefusal(
      () => applyTestDraftAsOneCommit({ configPath, request: request() }),
      DirtyApplyTargetError,
      'DirtyApplyTargetError',
    )

    expect(treeSnapshot()).toEqual(before)
    expect(commitCount()).toBe(commitsBefore)
  })

  it('does NOT block on an unrelated dirty file elsewhere in the repository', () => {
    // THE ALLOW SIDE. A repo-wide dirtiness check passes every refusal cell above and makes the
    // feature unusable in any real working session, so the admit direction needs its own cell.
    writeFileSync(join(root, 'README.md'), 'seeded, and edited by a person mid-session\n')

    const result = applyTestDraftAsOneCommit({ configPath, request: request() })

    expect(result.filePath).toBe(TARGET_PATH)
    expect(headStatPaths()).toEqual([TARGET_PATH])
  })

  it('keeps an unrelated STAGED file out of the commit', () => {
    // The person staged their own work before accepting. An `add` pathspec alone does not close
    // this: the index already carries their file, so the COMMIT has to name its pathspec too.
    writeFileSync(join(root, 'README.md'), 'seeded, staged by a person\n')
    git('add', '--', 'README.md')

    applyTestDraftAsOneCommit({ configPath, request: request() })

    expect(headStatPaths()).toEqual([TARGET_PATH])
  })

  it('stages nothing but its own target', () => {
    // The other half of the same rule: the apply must not quietly add a person's other work to
    // their index either, even where the commit's pathspec would keep it out of the commit.
    writeFileSync(join(root, 'README.md'), 'seeded, edited by a person\n')

    applyTestDraftAsOneCommit({ configPath, request: request() })

    const staged = git('diff', '--cached', '--name-only').stdout.trim()
    expect(staged).toBe('')
  })

  it('refuses by name when git is absent, rather than skipping the way a verification may', () => {
    const enoent: GitApplyExec = () => {
      const error = new Error('spawnSync git ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      return { status: null, signal: null, stdout: '', stderr: '', error }
    }
    expectRefusal(
      () => applyTestDraftAsOneCommit({ configPath, request: request(), exec: enoent }),
      GitUnavailableForApplyError,
      'GitUnavailableForApplyError',
    )
  })

  it('rethrows a non-ENOENT spawn failure instead of reading it as git saying no', () => {
    const eacces: GitApplyExec = () => {
      const error = new Error('spawnSync git EACCES') as NodeJS.ErrnoException
      error.code = 'EACCES'
      return { status: null, signal: null, stdout: '', stderr: '', error }
    }
    expect(() => applyTestDraftAsOneCommit({ configPath, request: request(), exec: eacces }))
      .toThrow(/EACCES/)
    expect(() => applyTestDraftAsOneCommit({ configPath, request: request(), exec: eacces }))
      .not.toThrow(GitUnavailableForApplyError)
  })

  it('refuses by name when the target changed between the proposal and the accept', () => {
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')
    const proposalTimeDigest = createHash('sha256').update('name: what the proposal read\n').digest('hex')

    expectRefusal(
      () => applyTestDraftAsOneCommit({
        configPath,
        request: request({ sourceDigest: proposalTimeDigest }),
      }),
      ApplyTargetChangedError,
      'ApplyTargetChangedError',
    )

    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(committed)
  })

  it('applies when the sourceDigest still matches the target on disk', () => {
    // The ADMIT side of the digest check, so a re-check that refused everything cannot pass.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')

    const result = applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: createHash('sha256').update(committed).digest('hex') }),
    })

    expect(result.filePath).toBe(TARGET_PATH)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
  })

  it('refuses by name when the proposal carries no sourceDigest and the target now exists', () => {
    // An absent digest is a claim about ABSENCE, not a waiver of the check.
    const committed = 'name: somebody got there first\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')

    expectRefusal(
      () => applyTestDraftAsOneCommit({ configPath, request: request() }),
      ApplyTargetChangedError,
      'ApplyTargetChangedError',
    )
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(committed)
  })

  it('refuses a target that escapes the workspace, by the computation that mints the identity', () => {
    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request({ targetPath: '../outside/evil.yaml' }),
    })).toThrow(/escapes config directory/)
  })

  it('puts the -- operand separator before every caller-controlled path', () => {
    const argv: string[][] = []
    const recording: GitApplyExec = (file, args, options) => {
      argv.push([file, ...args])
      return spawnSync(file, [...args], options) as ReturnType<GitApplyExec>
    }

    applyTestDraftAsOneCommit({ configPath, request: request(), exec: recording })

    // THE PROPERTY IS POSITIONAL, not "the token appears somewhere". Every argv line carrying the
    // caller-controlled target must have `--` IMMEDIATELY before it, which is the only arrangement
    // that stops a target beginning with a dash from being parsed as one of git's own options.
    const carrying = argv.filter((line) => line.includes(TARGET_PATH))
    expect(carrying.length).toBe(3)
    for (const line of carrying) {
      expect(line[line.indexOf(TARGET_PATH) - 1]).toBe('--')
    }
    // And the ONE line that carries no caller path carries no separator either, so the assertion
    // above is about paths rather than about a token this host sprinkles everywhere.
    const readOnly = argv.filter((line) => !line.includes(TARGET_PATH))
    expect(readOnly.map((line) => line[1])).toEqual(['rev-parse'])
  })

  it('issues no --amend, no -a and no ref-moving subcommand', () => {
    const argv: string[][] = []
    const recording: GitApplyExec = (file, args, options) => {
      argv.push([file, ...args])
      return spawnSync(file, [...args], options) as ReturnType<GitApplyExec>
    }

    applyTestDraftAsOneCommit({ configPath, request: request(), exec: recording })

    const subcommands = argv.map((line) => line[1])
    expect([...new Set(subcommands)].sort()).toEqual(['add', 'commit', 'rev-parse', 'status'])
    for (const line of argv) {
      expect(line).not.toContain('--amend')
      expect(line).not.toContain('-a')
      expect(line).not.toContain('--all')
      expect(line).not.toContain('-A')
      expect(line).not.toContain('-f')
      expect(line).not.toContain('--force')
    }
  })

  it('bounds every git invocation with a finite timeout', () => {
    const timeouts: number[] = []
    const recording: GitApplyExec = (file, args, options) => {
      timeouts.push(options.timeout)
      return spawnSync(file, [...args], options) as ReturnType<GitApplyExec>
    }

    applyTestDraftAsOneCommit({ configPath, request: request(), exec: recording })

    expect(timeouts.length).toBeGreaterThan(0)
    expect([...new Set(timeouts)]).toEqual([APPLY_GIT_TIMEOUT_MS])
    expect(Number.isFinite(APPLY_GIT_TIMEOUT_MS)).toBe(true)
  })
})

describe('a FAILED apply leaves the repository exactly as it found it (394-18, CR-05)', () => {
  /**
   * The real git binary for every command except one, which is answered as a failure.
   *
   * A passthrough rather than a scripted exec, for this file's own stated reason: the claim is
   * about what `git status`, `git diff --cached` and `git log` say afterwards, and only a real
   * repository can answer that. The single interception is the one thing a real binary will not do
   * on demand — fail at a chosen point.
   */
  function failingAt(subcommand: string, status = 1, stderr = 'fixture failure'): GitApplyExec {
    return (file, args, options) => {
      if (args[0] === subcommand) {
        return { status, signal: null, stdout: '', stderr, error: undefined } as ReturnType<GitApplyExec>
      }
      return spawnSync(file, [...args], options) as ReturnType<GitApplyExec>
    }
  }

  /** What the INDEX holds for one path, in git's own words. Empty means no entry at all. */
  function indexEntry(path: string): string {
    return git('ls-files', '--stage', '--', path).stdout.trim()
  }

  it('leaves NO index entry behind when the commit fails and the target was untracked', () => {
    // THE DEFECT, and the one that folds agent bytes into a person's next commit. The catch
    // restored the worktree and left the agent's blob staged, so the very next `git commit` —
    // which commits the INDEX — would have carried a file the apply told the caller it did not
    // write.
    const before = treeSnapshot()

    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request(),
      exec: failingAt('commit'),
    })).toThrow(/git commit exited/)

    expect(indexEntry(TARGET_PATH)).toBe('')
    expect(git('diff', '--cached', '--name-only').stdout.trim()).toBe('')
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
    expect(treeSnapshot()).toEqual(before)
  })

  it('restores the pre-apply INDEX ENTRY, rather than blanket-unstaging the path', () => {
    // A tracked target, committed and clean, so the apply is admitted. The pre-apply index entry
    // for that path is HEAD's blob, and after a failed commit it has to be HEAD's blob again —
    // not "absent", which is what an unconditional `git rm --cached` would leave and which would
    // stage a DELETION of the person's own committed test.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')
    const beforeIndex = indexEntry(TARGET_PATH)
    expect(beforeIndex).not.toBe('')

    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: createHash('sha256').update(committed).digest('hex') }),
      exec: failingAt('commit'),
    })).toThrow(/git commit exited/)

    expect(indexEntry(TARGET_PATH)).toBe(beforeIndex)
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(committed)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('does NOT revert a file whose commit already SUCCEEDED', () => {
    // The second defect the verifier named. `runGitCommit` read HEAD after committing, and a
    // failure of THAT read routed through the same catch — so a real commit was answered with a
    // worktree reverted against it, leaving the person's checkout disagreeing with their own
    // history at the file the agent had just written.
    const before = commitCount()

    let caught: unknown
    try {
      applyTestDraftAsOneCommit({ configPath, request: request(), exec: failingAt('rev-parse') })
    } catch (error) {
      caught = error
    }

    expect(typeof ApplyCommitHashUnavailableError).toBe('function')
    expect(caught).toBeInstanceOf(ApplyCommitHashUnavailableError)
    // THE COMMIT STANDS, and the worktree matches it.
    expect(commitCount()).toBe(before + 1)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('names NOTHING-TO-COMMIT rather than reporting it as a git failure', () => {
    // Reachable, and it is the accept of a draft whose bytes already ARE the target's: the digest
    // re-check passes, the write is a no-op, and the add stages nothing. It answered
    // `git commit exited 1` with an empty stderr, which is a real failure's sentence for a
    // situation that is not one — and the distinction is drawn from the INDEX rather than from
    // guessing at git's message, so a translated or reworded git cannot move it.
    writeFileSync(join(root, TARGET_PATH), DRAFT_BYTES)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed exactly these bytes')
    const before = commitCount()

    expectRefusal(
      () => applyTestDraftAsOneCommit({
        configPath,
        request: request({ sourceDigest: createHash('sha256').update(DRAFT_BYTES).digest('hex') }),
      }),
      ApplyProducedNoChangeError,
      'ApplyProducedNoChangeError',
    )

    expect(commitCount()).toBe(before)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('restores a PRE-STAGED blob exactly, at the mechanism that owns the index state', () => {
    // THE THIRD DIRECTION, pinned where it is reachable. Through the shipped entry point a person
    // with staged content at the target is refused by the dirty check BEFORE anything is written
    // (`git status --porcelain -- <path>` reports a staged change), so this arrangement cannot
    // reach the rollback today — measured, and recorded rather than arranged around by narrowing
    // a shipped refusal. What CAN be driven is the mechanism itself, against a real index: it must
    // put the person's own blob back, not HEAD's and not nothing.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')
    const mine = 'name: MY staged edit\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), mine)
    git('add', '--', TARGET_PATH)
    const staged = indexEntry(TARGET_PATH)

    const exec = spawnSync as unknown as GitApplyExec
    const captured = captureIndexEntry(exec, root, TARGET_PATH)
    // The agent's blob goes over the person's, exactly as the apply's own `git add` would.
    writeFileSync(join(root, TARGET_PATH), DRAFT_BYTES)
    git('add', '--', TARGET_PATH)
    expect(indexEntry(TARGET_PATH)).not.toBe(staged)

    restoreIndexEntry(exec, root, TARGET_PATH, captured)

    expect(indexEntry(TARGET_PATH)).toBe(staged)
  })

  it('CONTROL: an absent pre-apply entry is restored as ABSENT, never as HEAD', () => {
    // The other direction of the same mechanism, and the reason it is a capture rather than a
    // `git reset HEAD -- <path>`: for an untracked target there is nothing at HEAD to reset to,
    // and for a tracked one a reset would silently discard a staged blob that differs from HEAD.
    const exec = spawnSync as unknown as GitApplyExec
    const captured = captureIndexEntry(exec, root, TARGET_PATH)
    expect(captured).toBeUndefined()

    writeFileSync(join(root, TARGET_PATH), DRAFT_BYTES)
    git('add', '--', TARGET_PATH)
    expect(indexEntry(TARGET_PATH)).not.toBe('')

    restoreIndexEntry(exec, root, TARGET_PATH, captured)

    expect(indexEntry(TARGET_PATH)).toBe('')
  })
})
