import {
  closeSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

interface FsyncOperations {
  openSync(path: string, flags: string): number
  fsyncSync(fd: number): void
  closeSync(fd: number): void
}

const FSYNC_OPERATIONS: FsyncOperations = { openSync, fsyncSync, closeSync }

/** Hosts may reject directory handles with only these established portability errors. */
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set([
  'EINVAL',
  'EISDIR',
  'EPERM',
  'ENOTSUP',
])

function syncPath(path: string, operations: FsyncOperations): void {
  let fd: number | undefined
  try {
    fd = operations.openSync(path, 'r')
    operations.fsyncSync(fd)
  } finally {
    if (fd !== undefined) operations.closeSync(fd)
  }
}

/** Flush one regular file; every open, sync, and close failure remains fatal. */
export function fsyncFile(path: string): void {
  syncPath(path, FSYNC_OPERATIONS)
}

/** Flush one directory while tolerating only the queue's closed host-portability allowlist. */
export function fsyncDirectory(
  path: string,
  operations: FsyncOperations = FSYNC_OPERATIONS,
): void {
  try {
    syncPath(path, operations)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === undefined || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) throw error
  }
}

function collectTree(
  root: string,
  files: string[],
  directoriesBottomUp: string[],
): void {
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile()) {
      files.push(path)
      continue
    }
    if (entry.isDirectory()) {
      collectTree(path, files, directoriesBottomUp)
      continue
    }
    throw new TypeError(`fsyncTree supports only regular files and directories: ${path}`)
  }
  directoriesBottomUp.push(root)
}

/** Flush every regular file first, then every directory in deterministic bottom-up order. */
export function fsyncTree(root: string): void {
  const files: string[] = []
  const directoriesBottomUp: string[] = []
  collectTree(root, files, directoriesBottomUp)
  for (const file of files) fsyncFile(file)
  for (const directory of directoriesBottomUp) fsyncDirectory(directory)
}

/** Persist the source-parent entry, rename, then persist the destination-parent entry. */
export function durableRename(source: string, destination: string): void {
  fsyncDirectory(dirname(source))
  renameSync(source, destination)
  fsyncDirectory(dirname(destination))
}
