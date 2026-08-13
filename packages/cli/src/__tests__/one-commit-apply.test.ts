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
  ApplyRollbackFailedError,
  ApplyTargetChangedError,
  DirtyApplyTargetError,
  GitUnavailableForApplyError,
  applyTestDraftAsOneCommit,
  captureIndexEntry,
  createDraftAuthoringPort,
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
    // FIVE lines carry it as of 394-18: status, ls-files (the index capture), diff --cached (the
    // nothing-to-commit question), add and commit. Each new line is a read the rollback needs, and
    // each is under the same separator law as the two writes.
    const carrying = argv.filter((line) => line.includes(TARGET_PATH))
    expect(carrying.length).toBe(5)
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

    // 394-18 adds two READS to the happy path — `ls-files` captures the index state the rollback
    // restores, `diff` asks whether anything is staged — and nothing else. `update-index` is the
    // rollback's own write and is absent here BECAUSE this cell drives a successful apply, which
    // is the evidence that the restore does not run when nothing failed.
    const subcommands = argv.map((line) => line[1])
    expect([...new Set(subcommands)].sort())
      .toEqual(['add', 'commit', 'diff', 'ls-files', 'rev-parse', 'status'])
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

describe('a FAILED apply leaves the repository exactly as it found it (394-18, CR-05)', () => {
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

  it('refuses BYTE-UNCHANGED when the index capture fails, because the capture is above the write', () => {
    // THE PLACEMENT IS THE PROPERTY (394-20, CR-01). `captureIndexEntry` has four throw paths — a
    // non-zero `ls-files` status, an unparsable entry, an ENOENT/EACCES rethrow and the timeout —
    // and none of them is inside the try that owns the rollback. Below the write that is a hole:
    // the agent's bytes are already at the person's path when the capture throws, and the caller
    // was told nothing was written. Above the write it is an ordinary refusal, the posture every
    // other check before the write already has.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')
    const before = treeSnapshot()
    const beforeIndex = indexEntry(TARGET_PATH)
    const commitsBefore = commitCount()

    // The real binary for everything EXCEPT the capture's exact argv. Matching the whole line
    // rather than the subcommand keeps the cell about the capture read specifically.
    const failingCapture: GitApplyExec = (file, args, options) => {
      const line = args.join(' ')
      if (line === `ls-files --stage -- ${TARGET_PATH}`) {
        return {
          status: 128, signal: null, stdout: '', stderr: 'fixture: ls-files refused',
          error: undefined,
        } as ReturnType<GitApplyExec>
      }
      return spawnSync(file, [...args], options) as ReturnType<GitApplyExec>
    }

    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: createHash('sha256').update(committed).digest('hex') }),
      exec: failingCapture,
    })).toThrow(/git ls-files exited 128/)

    // The person's bytes, not the agent's — compared as CONTENT, and read back out of the tree.
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(committed)
    expect(treeSnapshot()).toEqual(before)
    expect(indexEntry(TARGET_PATH)).toBe(beforeIndex)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
    expect(commitCount()).toBe(commitsBefore)
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

  it('refuses a CONFLICTED index entry by name rather than collapsing it to stage 0', () => {
    // THE ONE UNREPRESENTABLE CASE (394-20, WR-02). A path in an unresolved merge holds entries at
    // stages 1/2/3 and no stage-0 entry, and `--cacheinfo` can only put back a stage-0 one — so a
    // capture that returned the first line would restore a resolved entry over a conflict the
    // person has not settled. The stage was parsed and required by a throw and then never read;
    // this is the read that makes it a precondition of the mechanism.
    const base = 'name: the base version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), base)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'the base version of this test')
    const trunk = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()

    git('checkout', '--quiet', '-b', 'theirs')
    writeFileSync(join(root, TARGET_PATH), 'name: THEIR version\nsteps:\n  - Open\n')
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'their edit')

    git('checkout', '--quiet', trunk)
    writeFileSync(join(root, TARGET_PATH), 'name: MY version\nsteps:\n  - Close\n')
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'my edit')

    const merged = git('merge', 'theirs')
    expect(merged.status).not.toBe(0)

    // The fixture's own precondition: real stages 1/2/3 and NO stage-0 entry, read out of git.
    const stages = git('ls-files', '--stage', '--', TARGET_PATH).stdout
      .split('\n').filter((line) => line.trim() !== '')
      .map((line) => line.split('\t')[0]?.split(' ')[2])
    expect(stages).toEqual(['1', '2', '3'])

    const exec = spawnSync as unknown as GitApplyExec
    let caught: unknown
    try {
      captureIndexEntry(exec, root, TARGET_PATH)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain(TARGET_PATH)
    expect((caught as Error).message).toContain('stage 1')
  })
})

/**
 * A person's committed test whose bytes are NOT valid UTF-8, built byte-wise on purpose.
 *
 * THE FIXTURE IS CONSTRUCTED, NEVER LITERAL. Three plans in this repository have shipped raw
 * control bytes into a source file and made `grep` answer nothing over hundreds of readable lines;
 * assembling the sequence from numbers keeps THIS file pure ASCII while the bytes under test are
 * not. `0xC3 0x28` is a truncated two-byte sequence and `0xFF 0xFE` is not a UTF-8 lead pair at
 * all — every one of them decodes to U+FFFD, which is exactly the loss WR-04 is about.
 *
 * AND IT IS A DOCUMENT THE PARSER ACCEPTS (394-29, WR-03). The digests below are no longer minted
 * here — they arrive through `parseDraft`, the only producer of `TestDraftApplyRequest.sourceDigest`
 * — and a producer refuses a file it cannot parse, so a fixture that was merely a `name` and
 * `steps` could pin only a digest no producer emits. `test-id` and `target` are required by
 * `TestDefinitionSchema`, so they are here; the hazard bytes sit in a trailing comment, which is
 * what makes the decoding parse while the bytes stay a UTF-8 hazard.
 */
const NON_UTF8_TARGET_BYTES = Buffer.concat([
  Buffer.from(
    'test-id: t_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle\n'
    + 'name: a person\'s committed test\n'
    + 'target: local-form\n'
    + 'steps:\n'
    + '  - Open the cart # ',
    'ascii',
  ),
  Buffer.from([0xc3, 0x28, 0xff, 0xfe]),
  Buffer.from('\n', 'ascii'),
])

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * The digest as the PRODUCT produces it — `parseDraft`, and nothing hand-minted beside it.
 *
 * WHY EVERY NON-UTF-8 CELL BELOW GOES THROUGH HERE (394-29, WR-03). `createHash(...).update(bytes)`
 * spelled in a test is a claim about a value, not about the system: it can pin an input no producer
 * emits, and a mutation differential over such a fixture reds only on the impossible one — it
 * cannot tell a vacuous corpus from a real closure. `parseDraft`'s `contentDigest` is the ONE
 * producer of `TestDraftApplyRequest.sourceDigest` (it reaches the request through
 * `authoring-draft-edit.ts`), so a digest obtained here is a digest the product can actually put on
 * a proposal.
 *
 * The `kind` is asserted before the digest is read, because a refused parse would otherwise hand
 * every caller `undefined` and let the cell pass for a reason that has nothing to do with its
 * subject.
 */
async function sourceDigestThroughTheProducer(): Promise<string> {
  const outcome = await createDraftAuthoringPort(configPath).parseDraft(TARGET_PATH)
  expect(outcome.kind).toBe('parsed')
  return (outcome as { draft: { contentDigest: string } }).draft.contentDigest
}

/**
 * The integrity half of every byte-fidelity cell, and without it they are vacuous.
 *
 * An assertion about bytes that never reached the subject unaltered passes for a reason that has
 * nothing to do with the subject. So before any of the WR-04 cells asks what the apply did, this
 * asks two things of the harness itself: the bytes on disk after `git add`/`git commit` are still
 * the bytes the fixture wrote (nothing between here and the subject re-encoded them), and they are
 * genuinely a UTF-8 hazard (a decode/re-encode round-trip CHANGES them). If the second ever stops
 * holding, the cells below would pass against the very round-trip they exist to forbid.
 */
function assertNonUtf8BytesSurviveTheHarness(absolutePath: string, expected: Buffer): void {
  const onDisk = readFileSync(absolutePath)
  expect(onDisk.equals(expected)).toBe(true)
  expect(Buffer.from(onDisk.toString('utf8'), 'utf8').equals(onDisk)).toBe(false)
}

describe('the write is INSIDE the rollback\'s reach, and both halves are bytes (394-23)', () => {
  it('restores the person\'s bytes when the WRITE ITSELF fails, because the write is inside the try', () => {
    // CR-01, THE THIRD AND LAST NARROWING. `writeFileSync` at the target truncates before it
    // writes, and it sat OUTSIDE the try whose catch owns the restore — so ENOSPC, EIO, EDQUOT or a
    // read-only remount mid-write left a person's committed test truncated, with the rollback never
    // running, under a doc block promising total restore. The seam is the only way to make a real
    // filesystem fail halfway on demand.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')
    const before = treeSnapshot()
    const commitsBefore = commitCount()

    let calls = 0
    const truncateThenFail = (absolutePath: string, bytes: Buffer): void => {
      calls += 1
      if (calls === 1) {
        writeFileSync(absolutePath, '')
        throw new Error('fixture: the target write failed mid-flight')
      }
      writeFileSync(absolutePath, bytes)
    }

    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: createHash('sha256').update(committed).digest('hex') }),
      writeTarget: truncateThenFail,
    })).toThrow(/the target write failed mid-flight/)

    // TWO calls: the apply's write and the rollback's restore, through the SAME primitive. One
    // call means the restore never ran, which is the defect stated as a number.
    expect(calls).toBe(2)
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(committed)
    expect(treeSnapshot()).toEqual(before)
    expect(commitCount()).toBe(commitsBefore)
    // THE INDEX IS DELIBERATELY NOT ASSERTED HERE, and the reason is a measurement rather than a
    // preference: this cell's write fails before `git add`, so the apply never touches the index at
    // all and every index claim it could make belongs to the restore's index arm — which has its
    // own cells. Asserting it here made mutation P (the capture moved into the try) red THIS cell
    // as well as its own, and two mutations reding one cell is a corpus that can no longer say
    // which of the two placements a future edit broke.
  })

  it('names BOTH failures when the rollback itself fails, instead of the restore replacing the original', () => {
    // WR-03. `restoreApplyFailure` was called bare inside the catch, so a restore that threw
    // replaced the error explaining why the apply failed with its own — and the caller was left
    // holding the second fact with no way to reach the first, at the one moment both matter.
    const committed = 'name: the committed version\nsteps:\n  - Open\n'
    writeFileSync(join(root, TARGET_PATH), committed)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed this test')

    let calls = 0
    const writeThenFailTheRestore = (absolutePath: string, bytes: Buffer): void => {
      calls += 1
      if (calls === 1) {
        writeFileSync(absolutePath, bytes)
        return
      }
      throw new Error('fixture: the rollback could not put the bytes back')
    }

    let caught: unknown
    try {
      applyTestDraftAsOneCommit({
        configPath,
        request: request({ sourceDigest: createHash('sha256').update(committed).digest('hex') }),
        exec: failingAt('commit'),
        writeTarget: writeThenFailTheRestore,
      })
    } catch (error) {
      caught = error
    }

    expect(typeof ApplyRollbackFailedError).toBe('function')
    expect(caught).toBeInstanceOf(ApplyRollbackFailedError)
    expect((caught as Error).name).toBe('ApplyRollbackFailedError')
    // ONE error carrying BOTH facts, each readable in the message a person actually sees.
    expect((caught as Error).message).toContain('git commit exited 1')
    expect((caught as Error).message).toContain('the rollback could not put the bytes back')
    expect((caught as Error).message).toContain(TARGET_PATH)
    // And carried structurally too, so a caller can re-raise either without parsing prose.
    const composite = caught as { applyError?: unknown; restoreError?: unknown }
    expect((composite.applyError as Error).message).toContain('git commit exited 1')
    expect((composite.restoreError as Error).message)
      .toContain('the rollback could not put the bytes back')
    expect(calls).toBe(2)
  })

  it('digests the target\'s RAW BYTES, so a target that is not valid UTF-8 still matches the proposal', async () => {
    // WR-04, the overwrite direction. `readTargetIfPresent` decoded as UTF-8 and the digest hashed
    // the decoded STRING, so every byte sequence that is not valid UTF-8 collapsed to the same
    // replacement characters — two genuinely different targets hashed alike, and once 394-23 moved
    // this half alone, a target that had not moved at all was refused as changed.
    //
    // THE DIGEST ARRIVES THROUGH THE PRODUCER (394-29, WR-03). It used to be minted here as
    // `createHash(...).update(NON_UTF8_TARGET_BYTES)` — a value no producer emitted at the time,
    // so this cell's fixture was one the product could not put on a proposal and the mutation leg
    // beside it red only on the impossible input.
    writeFileSync(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed a test whose bytes are not UTF-8')
    assertNonUtf8BytesSurviveTheHarness(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)

    const result = applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: await sourceDigestThroughTheProducer() }),
    })

    expect(result.filePath).toBe(TARGET_PATH)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
  })

  it('restores a non-UTF-8 target BYTE-IDENTICALLY, never through a decode round-trip', async () => {
    // WR-04, the rollback direction, and the one that destroys a person's file rather than
    // refusing: the restore wrote back a decoded string, so putting the bytes "back" replaced every
    // sequence the decoder could not read with U+FFFD. The INDEX half is deliberately not asserted
    // here — that is the index restore's own property, measured by its own cells, and asserting it
    // in both places would make two mutations red one cell and stop the differential distinguishing
    // them.
    writeFileSync(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed a test whose bytes are not UTF-8')
    assertNonUtf8BytesSurviveTheHarness(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    const beforeSha = sha256File(join(root, TARGET_PATH))
    // Produced, not minted — see the cell above and `sourceDigestThroughTheProducer` (WR-03).
    const sourceDigest = await sourceDigestThroughTheProducer()

    expect(() => applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest }),
      exec: failingAt('commit'),
    })).toThrow(/git commit exited/)

    expect(sha256File(join(root, TARGET_PATH))).toBe(beforeSha)
    expect(readFileSync(join(root, TARGET_PATH)).equals(NON_UTF8_TARGET_BYTES)).toBe(true)
  })
})

/**
 * ONE DIGEST RECIPE, BOTH SIDES (394-29, CR-02).
 *
 * 394-23 moved the apply's half to raw bytes and left the PRODUCER hashing the UTF-8 decoding, so
 * the two halves of one contract stopped agreeing on the day one of them was hardened — the fourth
 * recorded instance of the one-sided-hardening class in this phase. At the base both halves hashed
 * the decoding and therefore agreed; the disagreement was created by the fix, and it made a clean
 * non-UTF-8 target permanently unapplicable (T-394-104, an availability failure of the accept path).
 *
 * These two cells are the pin, and they are a PAIR on purpose: the first says the gate accepts what
 * nobody touched, the second says it still refuses what somebody did. A closure measured only by
 * the accept arm cannot tell a byte-true digest from no digest check at all.
 */
describe('the digest the producer emits is the digest the apply computes (394-29)', () => {
  it('ACCEPTS an untouched non-UTF-8 target whose sourceDigest came through parseDraft', async () => {
    writeFileSync(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed a test whose bytes are not UTF-8')
    assertNonUtf8BytesSurviveTheHarness(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)

    const produced = await sourceDigestThroughTheProducer()

    // THE TWO RECIPES NAMED SIDE BY SIDE, with the non-vacuity guard first: if the decoding ever
    // hashed to the same value as the bytes, the assertion below would hold under both recipes and
    // this cell would certify nothing.
    const overTheBytes = createHash('sha256').update(NON_UTF8_TARGET_BYTES).digest('hex')
    const overTheDecoding = createHash('sha256')
      .update(NON_UTF8_TARGET_BYTES.toString('utf8')).digest('hex')
    expect(overTheDecoding).not.toBe(overTheBytes)
    expect(produced).toBe(overTheBytes)

    // And the agreement stated where it matters — the apply proceeds rather than refusing a file
    // nobody moved.
    const result = applyTestDraftAsOneCommit({
      configPath,
      request: request({ sourceDigest: produced }),
    })
    expect(result.filePath).toBe(TARGET_PATH)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
  })

  it('mints the digest over the file\'s RAW BYTES in the PRODUCER, with no apply in the reading', async () => {
    // THE PRODUCER'S HALF PINNED ALONE (394-34 / WR-10), and it is the corpus's only cell that can
    // tell the two halves of this contract apart.
    //
    // Every other byte-fidelity cell states the AGREEMENT, so it is red whichever half breaks it: a
    // mutation of `parseDraft`'s recipe and a mutation of `readTargetIfPresent`'s read produce the
    // IDENTICAL red set through them — measured, three cells each, the same three. A corpus that
    // cannot distinguish which half moved cannot say a producer-side regression was caught, only
    // that something disagreed. This cell asks the producer a question the apply is not part of, so
    // the consumer mutation leaves it green and only the producer mutation reds it.
    writeFileSync(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    assertNonUtf8BytesSurviveTheHarness(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)

    const produced = await sourceDigestThroughTheProducer()

    // NON-VACUITY FIRST, on the same rule as the cell above: if the two recipes ever hashed this
    // fixture alike, the assertion below would hold under both and certify nothing.
    const overTheBytes = createHash('sha256').update(NON_UTF8_TARGET_BYTES).digest('hex')
    const overTheDecoding = createHash('sha256')
      .update(NON_UTF8_TARGET_BYTES.toString('utf8')).digest('hex')
    expect(overTheDecoding).not.toBe(overTheBytes)
    expect(produced).toBe(overTheBytes)
  })

  it('REFUSES by name when the target\'s bytes really changed between the parse and the apply', async () => {
    writeFileSync(join(root, TARGET_PATH), NON_UTF8_TARGET_BYTES)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'a person committed a test whose bytes are not UTF-8')

    const produced = await sourceDigestThroughTheProducer()

    // COMMITTED, NOT LEFT DIRTY, and the distinction is what makes this cell reach the digest gate
    // at all: `applyTestDraftAsOneCommit` asks the porcelain question FIRST, so a target edited and
    // left uncommitted refuses as dirty and the digest is never compared. A change somebody else
    // COMMITTED is perfectly clean and completely different from what the proposal read — the one
    // case only this gate can see.
    const movedUnderTheProposal = Buffer.concat([
      NON_UTF8_TARGET_BYTES,
      Buffer.from('  - Apply the coupon FREESHIP\n', 'ascii'),
    ])
    writeFileSync(join(root, TARGET_PATH), movedUnderTheProposal)
    git('add', '--', TARGET_PATH)
    git('commit', '--quiet', '-m', 'somebody else edited the same test')
    expect(readFileSync(join(root, TARGET_PATH)).equals(NON_UTF8_TARGET_BYTES)).toBe(false)

    const before = treeSnapshot()
    const commitsBefore = commitCount()
    let caught: unknown
    try {
      applyTestDraftAsOneCommit({ configPath, request: request({ sourceDigest: produced }) })
    } catch (error) {
      caught = error
    }

    expect(typeof ApplyTargetChangedError).toBe('function')
    expect(caught).toBeInstanceOf(ApplyTargetChangedError)
    expect((caught as Error).name).toBe('ApplyTargetChangedError')
    expect((caught as Error).message).toContain(TARGET_PATH)
    expect(treeSnapshot()).toEqual(before)
    expect(commitCount()).toBe(commitsBefore)
  })
})
