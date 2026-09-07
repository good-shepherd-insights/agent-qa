import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { isAbsenceErrno, pathPresent } from '../path-present.js'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'projection-path-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('projection path presence', () => {
  it('accepts real file/directory and only treats missing paths or parents as absent', () => {
    const root = fixture()
    const file = join(root, 'document')
    writeFileSync(file, 'bytes')
    expect(pathPresent(root, 'directory')).toBe('present')
    expect(pathPresent(file, 'file')).toBe('present')
    expect(pathPresent(join(root, 'missing'), 'file')).toBe('absent')
    expect(pathPresent(join(file, 'child'), 'file')).toBe('absent')
    expect(() => pathPresent(root, 'file')).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(() => pathPresent(file, 'directory')).toThrow(expect.objectContaining({ code: 'EISDIR' }))
  })

  it.each(['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP', 'EIO', 'EPERM', 'EISDIR'])(
    'classifies %s consistently for both document loaders', (code) => {
      expect(isAbsenceErrno({ code })).toBe(code === 'ENOENT' || code === 'ENOTDIR')
    },
  )

  it('propagates a real symlink loop', () => {
    const path = join(fixture(), 'loop')
    symlinkSync(path, path)
    expect(() => pathPresent(path, 'file')).toThrow(expect.objectContaining({ code: 'ELOOP' }))
  })

  it.skipIf(process.getuid?.() === 0)('propagates real EACCES under an unsearchable parent', () => {
    const holder = join(fixture(), 'holder')
    mkdirSync(holder)
    const path = join(holder, 'document')
    writeFileSync(path, 'bytes')
    chmodSync(holder, 0o000)
    try {
      expect(() => pathPresent(path, 'file')).toThrow(expect.objectContaining({ code: 'EACCES' }))
    } finally {
      chmodSync(holder, 0o755)
    }
  })
})
