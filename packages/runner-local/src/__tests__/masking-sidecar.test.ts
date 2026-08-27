// The per-run masking digest sidecar (Phase 405 plan 02, D-08).
//
// These cells pin the property the whole D-08 mechanism rests on: the sidecar records WHICH value
// each `<SECRET_n>` placeholder stood for WITHOUT recording the value. So the load-bearing
// assertions read the written file's BYTES and require the clear value — and the host key's hex —
// to be absent from them (T-405-06/T-405-07). The rest pin the run-dir family, the traversal guard
// the whole family shares, whole-file replacement, and the typed absence a foreign schema reads as.

import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'

import {
  MASKING_DIGESTS_FILE,
  MASKING_HOST_KEY_FILE,
  MASKING_DIGESTS_SCHEMA_VERSION,
  digestMaskedValue,
  readMaskingDigests,
  resolveMaskingHostKey,
  writeMaskingDigests,
} from '../masking-sidecar.js'
import { slugBranch } from '../branch-resolver.js'
import { RUNS_SUBDIR } from '../event-log.js'

function sidecarPath(root: string, runId: string): string {
  return join(root, RUNS_SUBDIR, slugBranch(runId), MASKING_DIGESTS_FILE)
}

describe('masking digest sidecar (405-02, D-08)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'masking-sidecar-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates the host key 0600 with 32 random bytes and reuses it byte-for-byte (T-405-07)', () => {
    const first = resolveMaskingHostKey(root)

    const keyFile = join(root, MASKING_HOST_KEY_FILE)
    expect(statSync(keyFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(keyFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toHaveLength(32)

    const second = resolveMaskingHostKey(root)
    expect(second.equals(first)).toBe(true)
  })

  it('digests a value as a keyed HMAC-SHA256, not a bare hash (T-405-06)', () => {
    const key = resolveMaskingHostKey(root)

    const digest = digestMaskedValue(key, 'hunter22')

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).toBe(createHmac('sha256', key).update('hunter22').digest('hex'))
    // A DIFFERENT KEY GIVES A DIFFERENT DIGEST — the whole point of keying: without the host key a
    // reader cannot dictionary-attack a short secret from the sidecar's bytes.
    const otherKey = Buffer.alloc(32, 7)
    expect(digestMaskedValue(otherKey, 'hunter22')).not.toBe(digest)
  })

  it('writes the sidecar beside events.jsonl with digests only — no clear value in its bytes', () => {
    const key = resolveMaskingHostKey(root)

    writeMaskingDigests({
      root,
      runId: 'run-1',
      key,
      entries: [{ placeholder: '<SECRET_0>', value: 'hunter22' }],
    })

    const file = sidecarPath(root, 'run-1')
    const bytes = readFileSync(file)
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    expect(parsed).toEqual({
      schemaVersion: MASKING_DIGESTS_SCHEMA_VERSION,
      algorithm: 'hmac-sha256',
      entries: { '<SECRET_0>': digestMaskedValue(key, 'hunter22') },
    })

    // THE PROPERTY THE MECHANISM EXISTS FOR, read off the bytes rather than the parse.
    expect(bytes.includes('hunter22')).toBe(false)
    expect(bytes.includes(key.toString('hex'))).toBe(false)
  })

  it('round-trips, reports a run with no sidecar as undefined, and never escapes runs/ (T-405-08)', () => {
    const key = resolveMaskingHostKey(root)
    writeMaskingDigests({
      root,
      runId: 'run-1',
      key,
      entries: [{ placeholder: '<SECRET_0>', value: 'hunter22' }],
    })

    expect(readMaskingDigests({ root, runId: 'run-1' })).toEqual({
      schemaVersion: MASKING_DIGESTS_SCHEMA_VERSION,
      algorithm: 'hmac-sha256',
      entries: { '<SECRET_0>': digestMaskedValue(key, 'hunter22') },
    })
    expect(readMaskingDigests({ root, runId: 'never-ran' })).toBeUndefined()

    writeMaskingDigests({
      root,
      runId: '../../escape',
      key,
      entries: [{ placeholder: '<SECRET_0>', value: 'hunter22' }],
    })
    const escaped = sidecarPath(root, '../../escape')
    expect(escaped.startsWith(join(root, RUNS_SUBDIR) + '/')).toBe(true)
    expect(readMaskingDigests({ root, runId: '../../escape' })?.entries['<SECRET_0>']).toBe(
      digestMaskedValue(key, 'hunter22'),
    )
  })

  it('replaces the file whole on a second write — the map only ever grows', () => {
    const key = resolveMaskingHostKey(root)
    writeMaskingDigests({
      root,
      runId: 'run-1',
      key,
      entries: [{ placeholder: '<SECRET_0>', value: 'hunter22' }],
    })
    writeMaskingDigests({
      root,
      runId: 'run-1',
      key,
      entries: [
        { placeholder: '<SECRET_0>', value: 'hunter22' },
        { placeholder: '<SECRET_1>', value: 'later-auth-value' },
      ],
    })

    const read = readMaskingDigests({ root, runId: 'run-1' })
    expect(Object.keys(read?.entries ?? {})).toEqual(['<SECRET_0>', '<SECRET_1>'])
    expect(read?.entries['<SECRET_1>']).toBe(digestMaskedValue(key, 'later-auth-value'))
  })

  it('reads a foreign schemaVersion or algorithm as a typed absence, never a throw or a wrong match', () => {
    const dir = join(root, RUNS_SUBDIR, slugBranch('run-1'))
    mkdirSync(dir, { recursive: true })

    writeFileSync(
      join(dir, MASKING_DIGESTS_FILE),
      JSON.stringify({ schemaVersion: 2, algorithm: 'hmac-sha256', entries: {} }),
    )
    expect(readMaskingDigests({ root, runId: 'run-1' })).toBeUndefined()

    writeFileSync(
      join(dir, MASKING_DIGESTS_FILE),
      JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', entries: {} }),
    )
    expect(readMaskingDigests({ root, runId: 'run-1' })).toBeUndefined()

    writeFileSync(join(dir, MASKING_DIGESTS_FILE), 'not json at all')
    expect(readMaskingDigests({ root, runId: 'run-1' })).toBeUndefined()
  })
})
