// THE SNAPSHOT PRODUCER (428 D-11/D-13). Not yet implemented: the cells in
// __tests__/snapshot-live-stream.test.ts describe it.

import type { LiveStreamCapability } from '../platform.js'
import type { RunTimerPort } from './ports.js'

export const LIVE_SNAPSHOT_INTERVAL_MS = 1_000
export const LIVE_KEEPALIVE_QUIET_MS = 2_000

export function createSnapshotLiveStream(_input: {
  capture: () => Promise<Uint8Array | undefined>
  timer?: RunTimerPort
  intervalMs?: number
}): LiveStreamCapability {
  return {
    kind: 'snapshot',
    async start() {},
    async ack() {},
    async stop() {},
  }
}

export function imageSizeOf(_bytes: Uint8Array): { width: number; height: number } {
  return { width: 0, height: 0 }
}
