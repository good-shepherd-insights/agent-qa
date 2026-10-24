import { statSync } from 'node:fs'

export type PathPresence = 'present' | 'absent'

/** The only filesystem errors that establish absence, including a vanished parent. */
export function isAbsenceErrno(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Distinguish absence from a filesystem refusal at every projection read boundary.
 * Only ENOENT/ENOTDIR mean absent. A present wrong kind is a host fault: EISDIR
 * for a directory in a document slot, and the same explicit shape for a non-directory
 * in the runs-root slot. Never manufacture ENOTDIR here: it would disguise a present
 * malformed root as absence. Other stat failures propagate unchanged.
 */
export function pathPresent(path: string, expect: 'file' | 'directory'): PathPresence {
  let stat
  try {
    stat = statSync(path)
  } catch (error) {
    if (isAbsenceErrno(error)) return 'absent'
    throw error
  }
  if (expect === 'file' ? stat.isFile() : stat.isDirectory()) return 'present'
  throw Object.assign(new Error(`EISDIR: expected ${expect} at projection read boundary`), {
    code: 'EISDIR',
    path,
  })
}
