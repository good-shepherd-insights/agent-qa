import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../../test-fixtures/eval-workspace/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8')) as {
  files: { path: string, sha256: string, bytes: number }[]
}
const sha = (path: string) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex')
const onDisk = (): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter(path => path !== 'MANIFEST.json')
    .sort()

it('EVAL-WORKSPACE-FIXTURE: the manifest lists every vendored file and nothing else', () => {
  const walked = onDisk()
  const listed = new Set(manifest.files.map(file => file.path))
  expect(walked.length).toBeGreaterThan(0)
  expect(walked.filter(path => !listed.has(path))).toEqual([])
  expect([...listed].filter(path => !walked.includes(path))).toEqual([])
})

it('EVAL-WORKSPACE-FIXTURE: every vendored file matches its manifest sha-256 and size', () => {
  expect(manifest.files.length).toBeGreaterThan(0)
  const drifted = manifest.files.filter(file =>
    sha(file.path) !== file.sha256 || readFileSync(join(root, file.path)).length !== file.bytes)
  expect(drifted.map(file => file.path)).toEqual([])
})

it('EVAL-WORKSPACE-FIXTURE: the frozen judge contracts and config keep their pinned hashes', () => {
  expect(sha('agent-qa-eval/contracts/judge-config.v1.json')).toBe('8f385c65a0c4011b7610a698c64848645c0cf51167b7e3f8018e280dd4ba9eea')
  expect(sha('agent-qa-eval/contracts/judge-config.v2.json')).toBe('7fc8f16e4210333638a7dd51f36cd9cc291c7a3a72809d96cc623de578b272ec')
  expect(sha('agent-qa.config.yaml')).toBe('6be9e2eedfe2b79d00ba80fc683748464002bd1fe28e8deb30d38ff71c7677f4')
})
