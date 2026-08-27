// The DISPLAY-UNMASK SEAM's cells (Phase 405 plan 10, D-08/D-10 · DETL-02).
//
// WHAT IS BEING MEASURED. `createDisplayUnmasker` is the restore leg of the D-08 mechanism: at a
// human-facing emit the dashboard host re-derives candidate secret values from its CURRENT sources
// and restores a `<SECRET_n>` placeholder ONLY when `HMAC(hostKey, candidate)` equals the digest
// the run's sidecar (405-02) recorded for that placeholder. The cells below pin the four
// properties that make that safe rather than merely convenient:
//
//   IDENTITY, NEVER INDEX — a host whose sources register in a DIFFERENT order than the run did
//   still restores each placeholder to ITS OWN value (Test 2). This is the whole reason the sidecar
//   exists; restoring by index would show `<SECRET_2>` as whatever happens to be second today.
//
//   HONEST DEGRADE — a rotated-away value, a missing sidecar, a missing key, a digest mismatch and
//   every `<EMAIL_n>` become a TYPED MARKER minted by `@vostride/agent-qa-schema` (405-06), never a
//   raw placeholder and never a wrong value (Tests 3, 4a).
//
//   SCOPE-LESS IS THE IDENTITY — chat calls `unmaskForDisplay(text)` with no run scope and has no
//   chip renderer, so the scope-less path returns its input byte for byte (Test 4b). A marker on
//   that path would put a raw U+241F in front of a person, which is exactly what D-10 forbids.
//
//   NO PRECISION LOSS, NO TIMING ORACLE — the comparison is `timingSafeEqual` over the full
//   32-byte digests, so a 60-of-64-hex-character near-match does not restore (Test 6).
//
// THE ARRANGE SIDE USES THE SHIPPED WRITER. Every sidecar in this file is produced by
// `writeMaskingDigests` over a context built by `buildRunMaskingContext` — the same pair the
// in-process run drive calls — so a change to the run's registration rule reds these cells rather
// than silently drifting the two halves apart.

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildRunMaskingContext,
  digestMaskedValue,
  resolveMaskingHostKey,
  writeMaskingDigests,
} from '@vostride/agent-qa-agent-local'
import {
  MASKING_DIGESTS_FILE,
  MASKING_HOST_KEY_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import { maskedMarker } from '@vostride/agent-qa-schema'

import { composeDashboardDoor } from '../../commands/dashboard.js'
import { createDisplayUnmasker } from '../display-unmask.js'

/** A secret store over a plain name→value record, in the shape the door's stores publish. */
function storeOf(secrets: Record<string, string>): {
  forEachSecret(cb: (name: string, value: string) => void): void
} {
  return {
    forEachSecret(cb) {
      for (const [name, value] of Object.entries(secrets)) cb(name, value)
    },
  }
}

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'display-unmask-'))
}

/**
 * Seed a run's sidecar exactly as the in-process drive does: one `buildRunMaskingContext` over the
 * given secrets, `snapshotRegistered()` for the SECRET rows, the shipped writer for the file.
 */
function seedSidecar(root: string, runId: string, secrets: Record<string, string>): void {
  const ctx = buildRunMaskingContext({ secretStore: storeOf(secrets), env: {} })
  writeMaskingDigests({
    root,
    runId,
    key: resolveMaskingHostKey(root),
    entries: ctx.snapshotRegistered().map(({ placeholder, value }) => ({ placeholder, value })),
  })
  ctx.dispose()
}

/** An unmasker whose only source is the given secret record — no env, no auth state. */
function unmaskerOver(root: string, secrets: Record<string, string>): (
  text: string,
  scope?: { runId: string },
) => string {
  return createDisplayUnmasker({
    agentQaRoot: root,
    secretStores: () => [storeOf(secrets)],
    env: () => ({}),
    authStatePayloads: () => [],
  })
}

/** Every regular file under a directory tree, as bytes. */
function readAllFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...readAllFiles(full))
    else out.push(readFileSync(full, 'utf8'))
  }
  return out
}

const RUN_ID = 'display-unmask-run'

describe('createDisplayUnmasker — the D-08 restore leg', () => {
  it('spells an unrestorable secret with the schema vocabulary, never a local literal', () => {
    const root = freshRoot()
    try {
      // No sidecar for this run at all: the only honest answer is the typed marker.
      const unmask = unmaskerOver(root, { API_KEY: 'alpha-value' })
      expect(unmask('<SECRET_0>', { runId: RUN_ID })).toBe(maskedMarker('secret'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores by VALUE IDENTITY even when the host now registers in the opposite order (D-08)', () => {
    const root = freshRoot()
    try {
      // The run registered alpha first, then beta — so `<SECRET_0>` IS alpha and `<SECRET_1>` IS beta.
      seedSidecar(root, RUN_ID, { A_KEY: 'alpha-value', B_KEY: 'beta-value' })

      // Today's host walks its stores in the REVERSED order. A seam that restored by registration
      // index would answer `beta-value and alpha-value` here — the exact disclosure D-08 forbids.
      const unmask = unmaskerOver(root, { B_KEY: 'beta-value', A_KEY: 'alpha-value' })

      expect(unmask('<SECRET_0> and <SECRET_1>', { runId: RUN_ID })).toBe('alpha-value and beta-value')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('degrades a rotated-away value to a typed marker while its neighbour still restores', () => {
    const root = freshRoot()
    try {
      seedSidecar(root, RUN_ID, { A_KEY: 'alpha-value', B_KEY: 'beta-value' })
      // beta rotated away; gamma took its place. Nothing this host holds digests to `<SECRET_1>`.
      const unmask = unmaskerOver(root, { A_KEY: 'alpha-value', G_KEY: 'gamma-value' })

      const out = unmask('<SECRET_0> and <SECRET_1>', { runId: RUN_ID })
      expect(out).toBe(`alpha-value and ${maskedMarker('secret')}`)
      expect(out).not.toContain('gamma-value')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks every placeholder when there is no sidecar, no key, or an EMAIL (4a)', () => {
    const noSidecar = freshRoot()
    const noKey = freshRoot()
    try {
      // (a) No sidecar for this run.
      const bare = unmaskerOver(noSidecar, { A_KEY: 'alpha-value' })
      expect(bare('<SECRET_0>', { runId: RUN_ID })).toBe(maskedMarker('secret'))

      // (b) A sidecar written under a key that is then ROTATED AWAY (deleted). Every digest in it
      // is now unmatchable, which is the intended cost of rotation.
      seedSidecar(noKey, RUN_ID, { A_KEY: 'alpha-value' })
      rmSync(join(noKey, MASKING_HOST_KEY_FILE), { force: true })
      const rotated = unmaskerOver(noKey, { A_KEY: 'alpha-value' })
      const out = rotated('<SECRET_0> and <EMAIL_0>', { runId: RUN_ID })
      expect(out).toBe(`${maskedMarker('secret')} and ${maskedMarker('email')}`)
      expect(out).not.toContain('<SECRET_')
      expect(out).not.toContain('<EMAIL_')
      expect(out).not.toContain('alpha-value')

      // (c) An EMAIL placeholder is never restorable, even on a run whose sidecar is intact.
      const withSidecar = unmaskerOver(noSidecar, { A_KEY: 'alpha-value' })
      expect(withSidecar('<EMAIL_3>', { runId: RUN_ID })).toBe(maskedMarker('email'))
    } finally {
      rmSync(noSidecar, { recursive: true, force: true })
      rmSync(noKey, { recursive: true, force: true })
    }
  })

  it('is the IDENTITY without a scope — chat keeps its `<SECRET_n>` posture (4b, D-10)', () => {
    const root = freshRoot()
    try {
      // A perfectly restorable run exists and the host holds the value. The scope-less call must
      // still change nothing: chat has no chip renderer, so a marker there reaches a person raw.
      seedSidecar(root, RUN_ID, { A_KEY: 'alpha-value' })
      const unmask = unmaskerOver(root, { A_KEY: 'alpha-value' })

      const input = 'a <SECRET_0> b <EMAIL_0> c'
      expect(unmask(input)).toBe(input)
      expect(unmask('')).toBe('')
      // And the scoped call over the same text is demonstrably NOT the identity, so the cell above
      // cannot pass because nothing works at all.
      expect(unmask(input, { runId: RUN_ID })).not.toBe(input)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never lets `<SECRET_1>` clobber `<SECRET_10>`, and honours the 4-character floor', () => {
    const root = freshRoot()
    try {
      // Eleven registered values so the run mints `<SECRET_0>` … `<SECRET_10>`, PLUS a 3-character
      // value that `minRegisteredLength` refuses and a 4-character one it accepts.
      const secrets: Record<string, string> = { TINY: 'abc', SMALL: 'abcd' }
      for (let index = 0; index <= 10; index += 1) secrets[`K_${String(index)}`] = `value-number-${String(index)}`
      seedSidecar(root, RUN_ID, secrets)

      const unmask = unmaskerOver(root, secrets)
      const out = unmask('[<SECRET_1>][<SECRET_10>]', { runId: RUN_ID })

      // `<SECRET_0>` is `abcd` (the 3-char `abc` was never registered, so it never took an index),
      // which shifts each `K_n` one place: `<SECRET_1>` is `value-number-0`, `<SECRET_10>` is
      // `value-number-9`. What matters is that they are DIFFERENT and neither is a prefix accident.
      expect(out).toBe('[value-number-0][value-number-9]')
      expect(out).not.toContain('<SECRET_')

      // The 4-character value restores; the 3-character one was never a placeholder at all.
      expect(unmask('<SECRET_0>', { runId: RUN_ID })).toBe('abcd')
      const ctx = buildRunMaskingContext({ secretStore: storeOf(secrets), env: {} })
      expect(ctx.snapshotRegistered().map((entry) => entry.value)).not.toContain('abc')
      ctx.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('compares the FULL 32-byte digest and treats malformed hex as no match (T-405-36/37)', () => {
    const root = freshRoot()
    try {
      const key = resolveMaskingHostKey(root)
      const correct = digestMaskedValue(key, 'alpha-value')
      // Same first 60 hex characters, different last 4. A truncated-prefix comparison would match.
      const nearMiss = `${correct.slice(0, 60)}${correct.slice(60) === '0000' ? '1111' : '0000'}`
      expect(nearMiss).not.toBe(correct)
      expect(nearMiss.slice(0, 60)).toBe(correct.slice(0, 60))

      writeMaskingDigestsRaw(root, RUN_ID, {
        '<SECRET_0>': nearMiss,
        '<SECRET_1>': 'not-hex-at-all',
        '<SECRET_2>': correct,
      })

      const unmask = unmaskerOver(root, { A_KEY: 'alpha-value' })
      expect(unmask('<SECRET_0>', { runId: RUN_ID })).toBe(maskedMarker('secret'))
      // Malformed hex is a no-match, not a throw.
      expect(() => unmask('<SECRET_1>', { runId: RUN_ID })).not.toThrow()
      expect(unmask('<SECRET_1>', { runId: RUN_ID })).toBe(maskedMarker('secret'))
      // And the control: an exact digest under the same key does restore.
      expect(unmask('<SECRET_2>', { runId: RUN_ID })).toBe('alpha-value')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes no clear value anywhere — the tmp root still holds none after the calls', () => {
    const root = freshRoot()
    try {
      seedSidecar(root, RUN_ID, { A_KEY: 'alpha-value' })
      const unmask = unmaskerOver(root, { A_KEY: 'alpha-value' })
      expect(unmask('<SECRET_0>', { runId: RUN_ID })).toBe('alpha-value')

      for (const contents of readAllFiles(root)) {
        expect(contents).not.toContain('alpha-value')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Write a sidecar with HAND-CHOSEN digests, bypassing the writer's own digesting.
 *
 * The precision cell needs entries the shipped writer cannot produce — a near-miss digest and
 * malformed hex — so it composes the file's declared shape directly. Every OTHER arrange in this
 * file goes through `writeMaskingDigests`; this one exists to measure what the reader does with
 * bytes an attacker could have put there (T-405-37).
 */
function writeMaskingDigestsRaw(root: string, runId: string, entries: Record<string, string>): void {
  const dir = join(root, RUNS_SUBDIR, slugBranch(runId))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, MASKING_DIGESTS_FILE),
    `${JSON.stringify({ schemaVersion: 1, algorithm: 'hmac-sha256', entries })}\n`,
    'utf8',
  )
}

// ---- The SHIPPED composition, end to end (405-10, D-08 truth 1) -------------------------------
//
// THE CELLS ABOVE MEASURE THE SEAM; THIS ONE MEASURES THAT PRODUCTION HAS IT. `composeDashboardDoor`
// is the function `agent-qa dashboard` calls, and `AgentHost.unmaskForDisplay` is what every local
// human read reaches through. Until 405-10 that member was a fresh empty masking context — a
// no-op that restored nothing — and every response-shape cell in this repository was green about
// it, because a no-op returns its input and an input with no placeholder in it looks fine. So the
// claim "the shipped host restores" cannot be made by any cell that supplies its own host, and
// this one supplies none: it composes the real door over a real runtime root, plants a sidecar
// through the shipped writer, and asks the composed `agentHost` directly.

describe('composeDashboardDoor binds the real display seam (D-08)', () => {
  it('restores a scoped placeholder from the door\'s own masking stores, and stays the identity without a scope', () => {
    const root = freshRoot()
    const configPath = join(root, 'agent-qa.config.yaml')
    writeFileSync(
      configPath,
      `${JSON.stringify({
        workspace: {
          testMatch: ['tests/**/*.test.yaml'],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        use: { mobile: { appState: 'reset' } },
        registry: { targets: {} },
      })}\n`,
      'utf8',
    )
    const agentQaRoot = join(root, '.agent-qa')

    // A run that masked one declared secret, recorded through the SHIPPED writer under the SHIPPED
    // key resolution — the same pair `in-process-run-execution.ts` calls at `onSession`.
    seedSidecar(agentQaRoot, RUN_ID, { DOOR_KEY: 'sk-door-alpha-value' })

    const { host, agentHost } = composeDashboardDoor({
      agentQaRoot,
      configPath,
      boundOrigin: () => undefined,
      resolveExecutionContext: () => 'local-interactive',
      // The accessor `createDashboardRunDoor` publishes and the command threads — the stores every
      // run through this door was seeded from, read live.
      maskingSecretStores: () => [storeOf({ DOOR_KEY: 'sk-door-alpha-value' })],
    })

    try {
      expect(agentHost.unmaskForDisplay('token <SECRET_0>', { runId: RUN_ID }))
        .toBe('token sk-door-alpha-value')
      // A placeholder this host cannot account for is a chip, never a raw placeholder.
      expect(agentHost.unmaskForDisplay('<SECRET_9>', { runId: RUN_ID })).toBe(maskedMarker('secret'))
      // And chat's one-argument call is byte-for-byte what it was before this plan.
      expect(agentHost.unmaskForDisplay('token <SECRET_0>')).toBe('token <SECRET_0>')
    } finally {
      void host.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
