import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { hostname as osHostname } from 'node:os'

const PLATFORM_UUID_LINE = /"IOPlatformUUID" = "([^"]*)"/
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readIoregPlatformUuid(): string | undefined {
  const result = spawnSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
    encoding: 'utf8',
    env: { LC_ALL: 'C', LANG: 'C' },
    timeout: 1_000,
    windowsHide: true,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  return PLATFORM_UUID_LINE.exec(result.stdout)?.[1]
}

function readUuidOrUndefined(read: () => string | undefined): string | undefined {
  try {
    const uuid = read()
    return uuid !== undefined && UUID_SHAPE.test(uuid) ? uuid : undefined
  } catch {
    return undefined
  }
}

// 2026-10-16 (442-17, GAP-D4): macOS host names follow the network; the hardware UUID does not.
export function createRunOwnerHostResolver({
  platform = process.platform,
  hostname = osHostname,
  readPlatformUuid = readIoregPlatformUuid,
}: {
  platform?: NodeJS.Platform
  hostname?: () => string
  readPlatformUuid?: () => string | undefined
} = {}): () => string {
  let identity: string | undefined
  return () => {
    if (platform !== 'darwin') return hostname()
    if (identity !== undefined) return identity
    const uuid = readUuidOrUndefined(readPlatformUuid)
    if (uuid === undefined) return `hostname:${hostname()}`
    identity = `macos-uuid-sha256:${createHash('sha256').update(uuid.toUpperCase()).digest('hex')}`
    return identity
  }
}

export const resolveRunOwnerHost = createRunOwnerHostResolver()
