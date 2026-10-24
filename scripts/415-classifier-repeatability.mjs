#!/usr/bin/env node
// Fold the Plan 14 operator checkpoint's analysis sweeps into local repeatability evidence.
// Build prerequisite: build the workspace first (pnpm build). In particular, this imports
// @vostride/agent-qa-eval from packages/eval/dist/index.js, plus built core/schema/ids helpers.
// The root scripts directory has no bare workspace-package links; use explicit dist entries.
//
// USAGE (from agent-qa/)
//   node scripts/415-classifier-repeatability.mjs --out <dir> --legs <campaign-legs.jsonl> \
//     [--k 3] [--write <file>]
//   node scripts/415-classifier-repeatability.mjs --selftest
//
// Real invocation belongs to the Plan 14 checkpoint after reanalyze-k3.sh. --selftest uses
// disposable fixtures only. This script never invokes a model or writes the committed corpus.
// Exit 0: guarded output/selftest passed. Exit 1: refusal or SELFTEST FAILED.

import { strict as assert } from 'node:assert'
// This file-hashing script is outside the architecture cell's gate-path ROOTS.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { isPathInsideDir } from '../packages/core/dist/index.js'
import {
  foldClassifierRepeatability,
  guardClassifierRepeatability,
} from '../packages/eval/dist/index.js'
import { generateRunId, generateTestId } from '../packages/ids/dist/index.js'
import { isVerdictClass } from '../packages/schema/dist/index.js'

function readOptional(file) {
  try {
    return readFileSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function foldFiles({ out, legs, k, write = join(out, 'classifier-repeatability.json') }) {
  const runs = []
  for (const line of readFileSync(legs, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const row = JSON.parse(line)
    if (!(Number(row.exitCode) >= 0)) continue
    if (
      typeof row.runSlug !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(row.runSlug) ||
      typeof row.product !== 'string' ||
      row.product.trim() === ''
    ) {
      throw new Error('invalid recorded run slug or product')
    }
    const sweeps = []
    for (let sweep = 1; sweep <= k; sweep += 1) {
      const file = join(out, `sweep-${sweep}`, row.runSlug, 'analysis.json')
      if (!isPathInsideDir(file, out)) throw new Error(`analysis path escapes output: ${file}`)
      const bytes = readOptional(file)
      if (bytes === undefined) continue
      const analysis = JSON.parse(bytes.toString('utf8'))
      if (!Array.isArray(analysis?.verdicts)) throw new Error(`verdicts absent from ${file}`)
      const verdicts = analysis.verdicts.map(verdict => {
        if (
          verdict === null ||
          typeof verdict !== 'object' ||
          !isVerdictClass(verdict.class) ||
          (verdict.testId != null && typeof verdict.testId !== 'string')
        ) {
          throw new Error(`invalid verdict in ${file}`)
        }
        return { testId: verdict.testId ?? undefined, class: verdict.class }
      })
      sweeps.push({ analysisDigest: createHash('sha256').update(bytes).digest('hex'), verdicts })
    }
    runs.push({ runSlug: row.runSlug, product: row.product, sweeps })
  }

  const costBytes = readOptional(join(out, 'cost.txt'))
  let cost
  if (costBytes !== undefined) {
    const match = /^reanalyze-k3: .*\bmodelCalls=(\d+) wallClock=(\d+)ms\s*$/.exec(
      costBytes.toString('utf8'),
    )
    if (match === null) throw new Error('malformed reanalyze-k3 cost.txt')
    cost = { modelCalls: Number(match[1]), wallClockMs: Number(match[2]) }
    if (!Object.values(cost).every(Number.isSafeInteger)) {
      throw new Error('cost.txt contains an unsafe integer')
    }
  }

  const result = foldClassifierRepeatability({ k, runs, cost })
  const guarded = guardClassifierRepeatability(result)
  if (guarded.kind !== 'ok') throw new Error(`script fold rejected: ${guarded.reason}`)
  mkdirSync(dirname(write), { recursive: true })
  writeFileSync(write, `${JSON.stringify(guarded.repeatability, null, 2)}\n`)
  console.log(
    `classifier-repeatability: n=${result.n} incomplete=${result.incomplete.length} ` +
      `classFlipRate=${result.classFlipRate ?? 'absent'} ` +
      `admitExcludeFlipRate=${result.admitExcludeFlipRate ?? 'absent'}`,
  )
  return guarded.repeatability
}

function selftest() {
  const out = mkdtempSync(join(tmpdir(), 'agent-qa-415-repeatability-'))
  try {
    // Use canonical generators for fixture IDs; no production identifier is hand-written.
    const slugs = Array.from({ length: 5 }, () => generateRunId())
    const testId = generateTestId()
    const classes = [
      ['test_bug', 'test_bug', 'test_bug'],
      ['test_bug', 'app_bug', 'test_bug'], // Both classes are outside EXCLUSION_CLASSES.
      ['flake', 'test_bug', 'test_bug'], // Only flake is inside EXCLUSION_CLASSES.
      ['test_bug', 'test_bug'], // The missing third sweep must not enter the denominator.
    ]
    const legs = join(out, 'campaign-legs.jsonl')
    writeFileSync(
      legs,
      slugs
        .map((runSlug, seq) =>
          JSON.stringify({
            seq,
            runSlug,
            product: `fixture-product-${seq}`,
            exitCode: seq === 4 ? -1 : 0,
          }),
        )
        .join('\n') + '\n',
    )
    for (const [run, vector] of classes.entries()) {
      for (const [sweep, cls] of vector.entries()) {
        const dir = join(out, `sweep-${sweep + 1}`, slugs[run])
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          join(dir, 'analysis.json'),
          JSON.stringify({
            parts: [],
            runId: slugs[run],
            schemaVersion: 1,
            verdicts: [{ class: cls, ...(run === 1 ? { testId } : {}) }],
          }) + '\n',
        )
      }
    }
    writeFileSync(
      join(out, 'cost.txt'),
      'reanalyze-k3: sweeps=3 legs=4 completed=11 failed=1 no-job=0 ' +
        'modelCalls=11 wallClock=123ms\n',
    )
    const result = foldFiles({ out, legs, k: 3 })
    assert.equal(result.n, 3)
    assert.deepEqual(result.incomplete, [slugs[3]])
    assert.equal(result.classFlips, 2)
    assert.equal(result.admitExcludeFlips, 1)
    assert.ok(Math.abs(result.classFlipRate - 2 / 3) < 1e-12)
    assert.ok(Math.abs(result.admitExcludeFlipRate - 1 / 3) < 1e-12)
    assert.deepEqual(result.cost, { modelCalls: 11, wallClockMs: 123 })
    assert.deepEqual(
      JSON.parse(readFileSync(join(out, 'classifier-repeatability.json'), 'utf8')),
      result,
    )
    assert.deepEqual(
      result.perRun.map(run => run.product),
      ['fixture-product-0', 'fixture-product-1', 'fixture-product-2'],
    )
    assert.deepEqual(result.perRun[1].classVectors, [['test_bug'], ['app_bug'], ['test_bug']])
    const bytes = readFileSync(join(out, 'sweep-1', slugs[0], 'analysis.json'))
    const expectedDigest = createHash('sha256').update(bytes).digest('hex')
    assert.deepEqual(result.perRun[0].digests, Array(3).fill(expectedDigest))

    // Raw bytes, not a reserialization, define provenance: whitespace changes the digest only.
    writeFileSync(
      join(out, 'sweep-1', slugs[0], 'analysis.json'),
      Buffer.concat([bytes, Buffer.from(' ')]),
    )
    rmSync(join(out, 'cost.txt'))
    const alternate = join(out, 'custom', 'repeatability.json')
    const withoutCost = foldFiles({ out, legs, k: 3, write: alternate })
    assert.equal(withoutCost.cost, undefined)
    assert.notEqual(withoutCost.perRun[0].digests[0], expectedDigest)
    assert.equal(withoutCost.perRun[0].classFlip, false)
    assert.deepEqual(JSON.parse(readFileSync(alternate, 'utf8')), withoutCost)

    writeFileSync(join(out, 'cost.txt'), 'modelCalls=unknown wallClock=0ms\n')
    assert.throws(() => foldFiles({ out, legs, k: 3 }), /malformed.*cost/)
    rmSync(join(out, 'cost.txt'))
    const incompleteFile = join(out, 'sweep-1', slugs[3], 'analysis.json')
    writeFileSync(incompleteFile, JSON.stringify({ verdicts: [{ class: 'not-a-verdict-class' }] }))
    assert.throws(() => foldFiles({ out, legs, k: 3 }), /invalid verdict/)
    console.log('SELFTEST PASSED')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

function parseOptions(argv) {
  const values = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    if (!['--out', '--legs', '--k', '--write'].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`)
    }
    const value = argv[i + 1]
    if (values.has(flag) || !value || value.startsWith('--')) {
      throw new Error(`expected one value for ${flag}`)
    }
    values.set(flag, value)
  }
  if (!values.has('--out') || !values.has('--legs')) {
    throw new Error('required: --out <dir> --legs <campaign-legs.jsonl> [--k 3] [--write <file>]')
  }
  const k = Number(values.get('--k') ?? 3)
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('--k must be a positive safe integer')
  return {
    out: resolve(values.get('--out')),
    legs: resolve(values.get('--legs')),
    k,
    ...(values.has('--write') ? { write: resolve(values.get('--write')) } : {}),
  }
}

const isSelftest = process.argv.length === 3 && process.argv[2] === '--selftest'
try {
  if (isSelftest) selftest()
  else foldFiles(parseOptions(process.argv.slice(2)))
} catch (error) {
  console.error(`${isSelftest ? 'SELFTEST FAILED' : 'REFUSING'}: ${error.message}`)
  process.exitCode = 1
}
