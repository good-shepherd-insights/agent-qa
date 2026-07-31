import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

import {
  LEASE_HEARTBEAT_TTL_MS,
  acquireWriterLease,
  readWriterLease,
} from '@vostride/agent-qa-knowledge-local';
import type { ConfigReaderPort } from '@vostride/agent-qa-agent';
import { describe, expect, it } from 'vitest';

import { runDaemonHost } from '../daemon/host.js';

const FIXTURE_ROLE = process.env.AGENT_QA_HEARTBEAT_FIXTURE_ROLE;
const FIXTURE_ROOT = process.env.AGENT_QA_HEARTBEAT_FIXTURE_ROOT;
const FIXTURE_MARKER = process.env.AGENT_QA_HEARTBEAT_FIXTURE_MARKER;
const FIXTURE_REPORT = process.env.AGENT_QA_HEARTBEAT_FIXTURE_REPORT;
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITEST_BIN = join(PACKAGE_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const THIS_TEST_FILE = fileURLToPath(import.meta.url);
const BLOCK_MARGIN_MS = 20_000;
const RECLAIM_MARGIN_MS = 1_000;

const daemonConfig: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/agent-qa-heartbeat-fixture.yaml',
    entries: [],
  }),
};

function requiredFixtureValue(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name} for daemon heartbeat fixture`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFile(
  path: string,
  child?: FixtureChild,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (child !== undefined && child.process.exitCode !== null) {
      const exited = await child.exit;
      throw new Error(`Fixture exited before writing ${path}:\n${exited.output}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for fixture file: ${path}`);
    }
    await delay(25);
  }
}

interface FixtureChild {
  process: ChildProcess;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>;
}

function startFixture(
  role: 'busy-daemon' | 'stopped-daemon' | 'contender',
  values: {
    root: string;
    marker?: string;
    report?: string;
  },
): FixtureChild {
  const child = spawn(
    process.execPath,
    [VITEST_BIN, 'run', THIS_TEST_FILE, '--pool=threads', '--maxWorkers=1'],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        AGENT_QA_HEARTBEAT_FIXTURE_ROLE: role,
        AGENT_QA_HEARTBEAT_FIXTURE_ROOT: values.root,
        AGENT_QA_HEARTBEAT_FIXTURE_MARKER: values.marker,
        AGENT_QA_HEARTBEAT_FIXTURE_REPORT: values.report,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  return {
    process: child,
    exit: new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal, output }));
    }),
  };
}

async function stopFixture(child: FixtureChild, wasStopped = false): Promise<void> {
  if (wasStopped && child.process.exitCode === null) {
    child.process.kill('SIGCONT');
  }
  if (child.process.exitCode === null) {
    child.process.kill('SIGKILL');
  }
  await child.exit;
}

if (FIXTURE_ROLE === 'contender') {
  describe('daemon heartbeat contender fixture', () => {
    it('records a real writer-lease acquisition attempt', () => {
      const root = requiredFixtureValue(FIXTURE_ROOT, 'fixture root');
      const report = requiredFixtureValue(FIXTURE_REPORT, 'fixture report');
      const attemptedAtMs = Date.now();
      const result = acquireWriterLease(root);
      writeFileSync(report, JSON.stringify({ attemptedAtMs, result }), 'utf8');
    });
  });
} else if (FIXTURE_ROLE === 'busy-daemon') {
  describe('daemon busy-loop fixture', () => {
    it(
      'holds the production daemon main thread beyond the lease TTL',
      async () => {
        const root = requiredFixtureValue(FIXTURE_ROOT, 'fixture root');
        const marker = requiredFixtureValue(FIXTURE_MARKER, 'fixture marker');
        const report = requiredFixtureValue(FIXTURE_REPORT, 'fixture report');
        const expectedError = 'busy-loop-fixture-complete';

        await expect(
          runDaemonHost({
            agentQaRoot: join(root, '.agent-qa'),
            knowledgeRoot: root,
            config: daemonConfig,
            model: () => {
              const startedAtMonotonicMs = performance.now();
              const startedAtWallMs = Date.now();
              writeFileSync(
                marker,
                JSON.stringify({ startedAtMonotonicMs, startedAtWallMs }),
                'utf8',
              );
              while (
                performance.now() - startedAtMonotonicMs <
                LEASE_HEARTBEAT_TTL_MS + BLOCK_MARGIN_MS
              ) {
                // Intentionally keep the daemon's main event loop synchronously occupied.
              }
              const durationMs = performance.now() - startedAtMonotonicMs;
              writeFileSync(report, JSON.stringify({ durationMs }), 'utf8');
              throw new Error(expectedError);
            },
          }),
        ).rejects.toThrow(expectedError);
      },
      LEASE_HEARTBEAT_TTL_MS + BLOCK_MARGIN_MS + 30_000,
    );
  });
} else if (FIXTURE_ROLE === 'stopped-daemon') {
  describe('daemon SIGSTOP fixture', () => {
    it(
      'keeps a production daemon startup alive until its process is stopped',
      async () => {
        const root = requiredFixtureValue(FIXTURE_ROOT, 'fixture root');
        const marker = requiredFixtureValue(FIXTURE_MARKER, 'fixture marker');
        await runDaemonHost({
          agentQaRoot: join(root, '.agent-qa'),
          knowledgeRoot: root,
          config: daemonConfig,
          model: () => {
            writeFileSync(marker, JSON.stringify({ readyAtMs: Date.now() }), 'utf8');
            return new Promise<never>(() => undefined);
          },
        });
      },
      LEASE_HEARTBEAT_TTL_MS * 3,
    );
  });
} else {
  describe('daemon heartbeat supervision across real process boundaries', () => {
    it(
      'keeps the writer lease held while only the daemon main loop is blocked past TTL',
      async () => {
        const root = mkdtempSync(join(tmpdir(), 'agent-qa-heartbeat-busy-'));
        const marker = join(root, 'busy-started.json');
        const daemonReport = join(root, 'busy-complete.json');
        const contenderReport = join(root, 'contender.json');
        const daemon = startFixture('busy-daemon', {
          root,
          marker,
          report: daemonReport,
        });

        try {
          await waitForFile(marker, daemon);
          const markerPayload = JSON.parse(readFileSync(marker, 'utf8')) as {
            startedAtWallMs: number;
          };
          const initialLease = readWriterLease(root);
          expect(initialLease.kind).toBe('parsed');
          if (initialLease.kind !== 'parsed') {
            throw new Error(`Expected parsed initial lease, received ${initialLease.kind}`);
          }

          await delay(LEASE_HEARTBEAT_TTL_MS + RECLAIM_MARGIN_MS);
          const contender = startFixture('contender', { root, report: contenderReport });
          const contenderExit = await contender.exit;
          expect(contenderExit, contenderExit.output).toMatchObject({ code: 0, signal: null });
          expect(existsSync(daemonReport)).toBe(false);

          const contenderPayload = JSON.parse(readFileSync(contenderReport, 'utf8')) as {
            attemptedAtMs: number;
            result: ReturnType<typeof acquireWriterLease>;
          };
          expect(contenderPayload.attemptedAtMs).toBeGreaterThanOrEqual(
            markerPayload.startedAtWallMs,
          );
          expect(contenderPayload.result).toEqual({
            kind: 'held',
            holder: expect.objectContaining({
              leaseId: initialLease.lease.leaseId,
              epoch: initialLease.lease.epoch,
            }),
          });

          const daemonExit = await daemon.exit;
          expect(daemonExit, daemonExit.output).toMatchObject({ code: 0, signal: null });
          const busyReport = JSON.parse(readFileSync(daemonReport, 'utf8')) as {
            durationMs: number;
          };
          expect(busyReport.durationMs).toBeGreaterThanOrEqual(
            LEASE_HEARTBEAT_TTL_MS + BLOCK_MARGIN_MS,
          );
        } finally {
          await stopFixture(daemon);
        }
      },
      LEASE_HEARTBEAT_TTL_MS + BLOCK_MARGIN_MS + 45_000,
    );

    it.runIf(process.platform !== 'win32')(
      'allows a real contender to reclaim with an epoch bump after whole-process SIGSTOP',
      async () => {
        const root = mkdtempSync(join(tmpdir(), 'agent-qa-heartbeat-sigstop-'));
        const marker = join(root, 'daemon-ready.json');
        const contenderReport = join(root, 'contender.json');
        const daemon = startFixture('stopped-daemon', { root, marker });
        let wasStopped = false;

        try {
          await waitForFile(marker, daemon);
          const initialLease = readWriterLease(root);
          expect(initialLease.kind).toBe('parsed');
          if (initialLease.kind !== 'parsed') {
            throw new Error(`Expected parsed initial lease, received ${initialLease.kind}`);
          }
          expect(daemon.process.kill('SIGSTOP')).toBe(true);
          wasStopped = true;

          await delay(LEASE_HEARTBEAT_TTL_MS + RECLAIM_MARGIN_MS);
          const contender = startFixture('contender', { root, report: contenderReport });
          const contenderExit = await contender.exit;
          expect(contenderExit, contenderExit.output).toMatchObject({ code: 0, signal: null });

          const contenderPayload = JSON.parse(readFileSync(contenderReport, 'utf8')) as {
            result: ReturnType<typeof acquireWriterLease>;
          };
          expect(contenderPayload.result).toEqual({
            kind: 'acquired',
            epoch: initialLease.lease.epoch + 1,
            leaseId: expect.any(String),
            reclaimed: expect.objectContaining({
              epoch: initialLease.lease.epoch,
              leaseId: initialLease.lease.leaseId,
            }),
          });
        } finally {
          await stopFixture(daemon, wasStopped);
        }
      },
      LEASE_HEARTBEAT_TTL_MS + 45_000,
    );
  });
}
