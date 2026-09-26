import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, unlink, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { AuthCredential, AuthStore } from './types.js'

export function getAuthPath(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return join(xdg, 'agent-qa', 'auth.json')
  return join(homedir(), '.agent-qa', 'auth.json')
}

async function writeStoreAtomic(authPath: string, store: AuthStore): Promise<void> {
  const directory = dirname(authPath)
  const tempPath = join(directory, `.${basename(authPath)}.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(tempPath, JSON.stringify(store, null, 2), { mode: 0o600 })
    await rename(tempPath, authPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readAuth(path?: string): Promise<AuthStore> {
  const authPath = path ?? getAuthPath()
  try {
    const data = await readFile(authPath, 'utf-8')
    return JSON.parse(data) as AuthStore
  } catch {
    return {}
  }
}

export async function writeAuth(
  provider: string,
  credential: AuthCredential,
  path?: string,
): Promise<void> {
  const authPath = path ?? getAuthPath()
  const store = await readAuth(authPath)
  store[provider] = credential
  await writeStoreAtomic(authPath, store)
}

export async function removeAuth(provider: string, path?: string): Promise<void> {
  const authPath = path ?? getAuthPath()
  const store = await readAuth(authPath)
  delete store[provider]
  if (Object.keys(store).length === 0) {
    try {
      await unlink(authPath)
    } catch {
      // file already gone
    }
    return
  }
  await writeStoreAtomic(authPath, store)
}

export async function getCredential(
  provider: string,
  path?: string,
): Promise<AuthCredential | null> {
  const store = await readAuth(path)
  return store[provider] ?? null
}
