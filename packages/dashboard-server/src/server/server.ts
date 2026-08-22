import { createServer, type Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { cpus } from 'node:os'
import type { DashboardDatabase } from '../db/database.js'
import { createRouter } from './routes.js'
import { backstopServerError, refuseUnparseableRequest, tryParseRequestUrl } from './request-url.js'
import { TestRunner } from '../execution/test-runner.js'
import { JobQueue } from '../queue/job-queue.js'
import { TestFileManager } from '../tests/test-file-manager.js'
import { SuiteFileManager } from '../tests/suite-file-manager.js'
import { ConfigManager } from '../config/index.js'
import { AppiumManager } from '../execution/appium-manager.js'
import { WebSocketServer } from 'ws'
import { SessionManager } from '../live-editor/session-manager.js'
import { createSessionHandler } from '../live-editor/ws-handler.js'
import {
  type ResolvedWorkspacePaths,
} from '@vostride/agent-qa-core'
import type { DashboardLLMConfig } from '../llm-model-mapping.js'
import type { AgentHost } from '../chat/host.js'
// 396-01 D-10: the `@vostride/agent-qa-mcp` import is GONE, together with the MCP endpoint this
// server used to start beside the dashboard. The v2 server is composed per-caller by the CLI's own
// host (`agent-qa mcp`) over the function registry, so a dashboard that mounted its own copy would
// be a second composition root for the same surface — the private power the milestone abolishes.
// M5's dashboard rebuild decides whether it wants a mount back, via `/hono` and its own decision.

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.webp': 'image/webp',
}

function isAnalyticsPrivacyEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const analytics = (config as { analytics?: unknown }).analytics
  return Boolean(analytics && typeof analytics === 'object'
    && (analytics as { privacy?: unknown }).privacy === true)
}

interface StartServerOptions {
  db: DashboardDatabase
  port?: number
  uiDir?: string
  artifactsDir?: string
  workspacePaths?: ResolvedWorkspacePaths
  configPath?: string
  llmConfig?: DashboardLLMConfig & {
    vision?: { screenshotSize?: number; effectiveResolution?: number }
  }
  authFetch?: typeof globalThis.fetch
  /**
   * The composed agent host the chat door dispatches through (400-01, D-01).
   *
   * INJECTED by whoever starts this server — in production `agent-qa dashboard`, which composes the
   * SAME port set `agent-qa chat` does and hands it over, so the two interactive doors have one
   * answer to "what can a conversation do" (D-08). Absent leaves the chat routes answering 501 by
   * name: the door exists, this process was started without a host. See `chat/host.ts`.
   */
  agentHost?: AgentHost
}

export async function startServer(opts: StartServerOptions): Promise<{
  server: Server
  port: number
  close: () => void
}> {
  const { db, port = 3470, uiDir, artifactsDir, workspacePaths, configPath, llmConfig, authFetch, agentHost } = opts

  const resolvedConfigPath = configPath ?? resolve('agent-qa.config.yaml')
  const configManager = new ConfigManager(resolvedConfigPath)

  // Read concurrency from config (defaults to os.cpus().length)
  const config = await configManager.read().catch(() => ({}))
  const concurrency = typeof (config as any).concurrency === 'number'
    ? (config as any).concurrency
    : cpus().length

  let testRunner: TestRunner | undefined

  const finalizeRunArtifactBestEffort = (
    runId: string,
    code: string,
    phase: string,
    message: string,
    runtime: Record<string, unknown> = {},
  ): void => {
    try {
      const artifact = db.getRunArtifact(runId)
      if (!artifact || artifact.finalizedAt) return
      db.finalizeRunArtifact(runId, {
        runtime,
        errors: [{ code, phase, message }],
      } as any)
    } catch { /* best-effort cleanup */ }
  }

  // Resolve CLI binary once — used by TestRunner
  let cliBin: string | undefined
  try {
    cliBin = TestRunner.resolveCliBin()
  } catch {
    console.warn('Warning: Could not resolve agent-qa CLI binary. Execution will not work.')
  }

  // TestRunner for live test execution
  if (cliBin) {
    testRunner = new TestRunner({
      cliBin,
      onProcessClose: (runId, status) => {
        // If the child process exited but the DB row is still 'running',
        // update it so the dashboard doesn't show a stuck run.
        try {
          const run = db.getRun(runId)
          const handle = testRunner!.getHandle(runId)
          const isBrowserDisconnect = handle?.output.some(line =>
            line.includes('Target page, context or browser has been closed') ||
            line.includes('Browser closed by user')
          )
          if (run && (run.status === 'running' || run.status === 'cancelled')) {
            const duration = run.startedAt
              ? Date.now() - new Date(run.startedAt).getTime()
              : 0

            let dbStatus: string
            let failureSummary: string | undefined
            let errorLog: string | undefined
            const explicitCancellation = run.status === 'cancelled' || status === 'cancelled'
            if (explicitCancellation) {
              dbStatus = 'cancelled'
              failureSummary = undefined
            } else if (status === 'timeout') {
              dbStatus = 'failed'
              failureSummary = 'Test timed out -- process was killed'
            } else if (status === 'completed') {
              dbStatus = 'failed'
              failureSummary = 'Process exited before test completed'
            } else if (isBrowserDisconnect) {
              dbStatus = 'cancelled'
              failureSummary = 'Browser closed by user'
            } else {
              dbStatus = 'failed'
              const outputLines = handle?.output.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')) ?? []
              const meaningfulLine = [...outputLines].reverse().find(l =>
                /error/i.test(l) || l.includes('Parse') || l.includes('not found') || l.includes('rejected')
              )
              failureSummary = meaningfulLine
                ? meaningfulLine.slice(0, 300)
                : 'Process exited before test completed'
            }

            if (dbStatus === 'failed' && handle?.output.length) {
              errorLog = handle.output
                .join('\n')
                .replace(/\x1b\[[0-9;]*m/g, '')
                .slice(-10000) || undefined
            }

            // Suite parent: derive status from child test runs
            if (run.suiteId && !run.parentRunId) {
              const children = db.getRunsByParent(runId)
              const incompleteChildStatus = dbStatus === 'cancelled' ? 'cancelled' : 'failed'
              const incompleteChildSummary = incompleteChildStatus === 'cancelled'
                ? 'Suite cancelled'
                : failureSummary ?? 'Suite process terminated'

              for (const child of children) {
                if (child.status === 'running' || child.status === 'pending') {
                  db.updateRun(child.id, {
                    status: incompleteChildStatus,
                    endedAt: new Date().toISOString(),
                    failureSummary: incompleteChildSummary,
                  })
                  finalizeRunArtifactBestEffort(
                    child.id,
                    'suite-process-close',
                    'process-close',
                    incompleteChildSummary,
                    { status: incompleteChildStatus, finalStatus: incompleteChildStatus, processStatus: status },
                  )
                }
              }

              const updatedChildren = db.getRunsByParent(runId)

              const statusPriority: Record<string, number> = {
                failed: 4,
                cancelled: 3,
                flaky: 2,
                passed: 1,
                skipped: 0,
                pending: 0,
                running: 0,
              }

              let worstStatus = 'passed'
              let worstPriority = 0
              for (const child of updatedChildren) {
                const p = statusPriority[child.status] ?? 0
                if (p > worstPriority) {
                  worstPriority = p
                  worstStatus = child.status
                }
              }

              if (updatedChildren.length === 0) {
                if (isBrowserDisconnect) {
                  worstStatus = 'cancelled'
                } else {
                  worstStatus = dbStatus
                }
              }

              db.updateRun(runId, {
                status: worstStatus,
                duration,
                endedAt: new Date().toISOString(),
                failureSummary: worstStatus === 'failed' ? 'Suite test(s) failed'
                  : worstStatus === 'cancelled' ? (isBrowserDisconnect ? 'Browser closed by user' : 'Suite cancelled')
                  : undefined,
              })
              finalizeRunArtifactBestEffort(
                runId,
                'suite-process-close',
                'process-close',
                worstStatus === 'cancelled' ? (isBrowserDisconnect ? 'Browser closed by user' : 'Suite cancelled') : 'Suite process closed',
                { status: worstStatus, finalStatus: worstStatus, processStatus: status, duration },
              )

              releaseMobileAppiumLease(runId, 'suite-process-close')
              jobQueue.onSlotFreed(runId)
              return
            }

            // Check for retry child runs and classify accordingly
            const childRuns = db.getRunsByParent(runId)
            if (childRuns.length > 0) {
              const incompleteChildStatus = dbStatus === 'cancelled' ? 'cancelled' : 'failed'
              const incompleteChildSummary = incompleteChildStatus === 'cancelled'
                ? 'Retry cancelled'
                : failureSummary ?? 'Retry process terminated'
              for (const child of childRuns) {
                if (child.status === 'running' || child.status === 'pending') {
                  db.updateRun(child.id, {
                    status: incompleteChildStatus,
                    endedAt: new Date().toISOString(),
                    failureSummary: incompleteChildSummary,
                  })
                  finalizeRunArtifactBestEffort(
                    child.id,
                    'retry-process-close',
                    'process-close',
                    incompleteChildSummary,
                    { status: incompleteChildStatus, finalStatus: incompleteChildStatus, processStatus: status },
                  )
                }
              }

              const updatedChildRuns = db.getRunsByParent(runId)
              const anyPassed = updatedChildRuns.some(r => r.status === 'passed')
              const firstPassed = updatedChildRuns[0]?.status === 'passed'
              if (anyPassed && !firstPassed) {
                dbStatus = 'flaky'
              } else if (anyPassed && firstPassed) {
                dbStatus = 'passed'
              } else if (dbStatus === 'cancelled' || updatedChildRuns.some(r => r.status === 'cancelled')) {
                dbStatus = 'cancelled'
              } else {
                dbStatus = 'failed'
              }
              const lastChild = updatedChildRuns[updatedChildRuns.length - 1]
              db.updateRun(runId, {
                status: dbStatus,
                duration,
                endedAt: new Date().toISOString(),
                failureSummary: dbStatus === 'failed' ? 'All retry attempts failed'
                  : dbStatus === 'cancelled' ? 'Retry cancelled'
                  : undefined,
              })
              finalizeRunArtifactBestEffort(
                runId,
                'retry-process-close',
                'process-close',
                dbStatus === 'failed' ? 'All retry attempts failed'
                  : dbStatus === 'cancelled' ? 'Retry cancelled'
                  : 'Retry process closed',
                { status: dbStatus, finalStatus: dbStatus, processStatus: status, duration },
              )
              db.updateRunRetryInfo(runId, {
                retryCount: updatedChildRuns.length,
                maxRetries: lastChild?.maxRetries ?? run.maxRetries,
              })
              releaseMobileAppiumLease(runId, 'retry-process-close')
              jobQueue.onSlotFreed(runId)
              return
            }

            db.updateRun(runId, {
              status: dbStatus,
              duration,
              endedAt: new Date().toISOString(),
              failureSummary,
              errorLog,
            })
            finalizeRunArtifactBestEffort(
              runId,
              isBrowserDisconnect ? 'browser-disconnect' : 'process-close',
              'process-close',
              failureSummary ?? 'Process closed',
              { status: dbStatus, finalStatus: dbStatus, processStatus: status, duration },
            )
          }
        } catch { /* best-effort */ }

        releaseMobileAppiumLease(runId, status)
        jobQueue.onSlotFreed(runId)
      },
    })
  }

  // Clean up orphaned runs from previous server sessions — any run still
  // marked 'running' in the DB has no live process and should be failed.
  // Suite parents with active children are skipped (CLI process may still be running).
  const orphaned = db.getRuns({ status: 'running' })
  let cleaned = 0
  for (const run of orphaned) {
    if (run.suiteId && !run.parentRunId) {
      const children = db.getRunsByParent(run.id)
      if (children.some(c => c.status === 'running')) {
        continue
      }
    }
    const duration = run.startedAt
      ? Date.now() - new Date(run.startedAt).getTime()
      : 0
    db.updateRun(run.id, {
      status: 'failed',
      duration,
      endedAt: new Date().toISOString(),
      failureSummary: 'Process terminated unexpectedly (server restarted)',
    })
    finalizeRunArtifactBestEffort(run.id, 'server-restart', 'startup-cleanup', 'Process terminated unexpectedly (server restarted)', { status: 'failed', duration })
    cleaned++
  }
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} orphaned run(s) stuck in 'running' state`)
  }

  // Log any pending rows left from previous session (benign — picked up when queue starts)
  const pendingOrphans = db.getRuns({ status: 'pending' })
  if (pendingOrphans.length > 0) {
    console.log(`Found ${pendingOrphans.length} pending run(s) from previous session — will be processed when queue starts`)
  }

  // Appium lifecycle manager — auto-starts Appium for mobile tests
  const appiumManager = new AppiumManager()
  const mobileRuns = new Map<string, 'android' | 'ios'>()

  const releaseMobileAppiumLease = (runId: string, reason: string): void => {
    const platform = mobileRuns.get(runId)
    if (!platform) return
    mobileRuns.delete(runId)
    appiumManager.releaseLease(runId, reason)
  }

  const releaseAllMobileAppiumLeases = (reason: string): void => {
    for (const runId of [...mobileRuns.keys()]) {
      releaseMobileAppiumLease(runId, reason)
    }
  }

  // The persistent RUN QUEUE — all run triggers route through this. Named per D-21: it is not
  // the curation queue and not the agent job queue. The `JobQueue` class name is v1 vocabulary
  // that D-21 leaves unrenamed; only what an operator reads carries the qualifier.
  const jobQueue = new JobQueue({ db, concurrency })
  console.log(`Run queue started with ${concurrency} concurrency slot(s)`)
  console.log('Appium lifecycle manager initialized (auto-start on first mobile test)')

  // Wire JobQueue 'execute' event to TestRunner
  jobQueue.on('execute', async (run) => {
    if (!testRunner) return

    const platform = run.platform ?? 'web'
    const isMobile = platform === 'ios' || platform === 'android'

    // Ensure Appium is running before mobile test execution
    if (isMobile) {
      try {
        await appiumManager.acquireLease({ runId: run.id, platform })
        mobileRuns.set(run.id, platform)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Failed to start Appium for run ${run.id}: ${message}`)
        db.updateRun(run.id, {
          status: 'failed',
          failureSummary: `Appium server failed to start: ${message}`,
          endedAt: new Date().toISOString(),
        })
        finalizeRunArtifactBestEffort(run.id, 'appium-startup', 'appium-startup', `Appium server failed to start: ${message}`, { status: 'failed' })
        jobQueue.onSlotFreed(run.id)
        return
      }
    }

    const meta = (run.metadata ?? {}) as Record<string, unknown>
    const args = Array.isArray(meta.args)
      ? meta.args.filter((arg): arg is string => typeof arg === 'string')
      : []
    if (args.length === 0 && run.filePath) {
      args.push(run.filePath)
    }
    testRunner.execute({
      runId: run.id,
      args,
      source: meta.isSuite ? 'suite' : 'dashboard',
      attributes: run.attributes,
      timeout: meta.timeout as number | undefined,
      maxRetries: run.maxRetries,
      env: isMobile ? { AGENT_QA_APPIUM_URL: appiumManager.getUrl() } : undefined,
    })
  })

  // Wire cancellation — running jobs need process kill via TestRunner
  jobQueue.on('cancel-running', (runId: string) => {
    testRunner?.kill(runId)
  })

  // Start the queue polling loop
  jobQueue.start()

  // TestFileManager for test file CRUD
  const testFileManager = workspacePaths ? new TestFileManager(workspacePaths) : undefined

  const suiteFileManager = workspacePaths ? new SuiteFileManager(workspacePaths, testFileManager) : undefined

  const sessionManager = new SessionManager({
    appiumManager,
    configManager,
    configPath: resolvedConfigPath,
  })

  const apiRouter = createRouter({
    db,
    artifactsDir,
    workspacePaths,
    testRunner,
    jobQueue,
    testFileManager,
    suiteFileManager,
    configManager,
    configPath: resolvedConfigPath,
    llmConfig,
    authFetch,
    sessionManager,
    // 400-01: conditionally spread on the house rule an absent dependency is an ABSENT field and
    // never a present `undefined` — the router's own 501 arm is what decides, in one place.
    ...(agentHost === undefined ? {} : { agentHost }),
  })

  // THE PROCESS-LEVEL BACKSTOP AND THE GUARDED PARSE (400-16, gap 7). Every request enters here, so
  // this is the choke point: an unparseable request line is answered 400 before any frame below can
  // see it, and the whole body runs inside a `try` so a synchronous throw out of `apiRouter` — or a
  // rejection of anything awaited below — becomes a 500 instead of an unhandled rejection that ends
  // the process. `server.ts`'s listener is `async`, which is why the ONE `catch` covers both. The
  // full throw-path enumeration, and what each frame owns, lives in `./request-url.ts`.
  const server = createServer(async (req, res) => {
    try {
      const url = tryParseRequestUrl(req)
      if (url === undefined) {
        refuseUnparseableRequest(res)
        return
      }
      const path = url.pathname

      // API routes
      if (path.startsWith('/api/')) {
        apiRouter(req, res)
        return
      }

      // OPTIONS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end()
        return
      }

      // Static file serving
      if (uiDir) {
        const filePath = path === '/' ? join(uiDir, 'index.html') : join(uiDir, path)

        try {
          const fileStat = await stat(filePath)
          if (fileStat.isFile()) {
            const content = await readFile(filePath)
            const ext = extname(filePath)
            const contentType = MIME_TYPES[ext] || 'application/octet-stream'
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': content.length,
              'Access-Control-Allow-Origin': '*',
            })
            res.end(content)
            return
          }
        } catch {
          // File not found — fall through to SPA fallback
        }

        // SPA fallback: serve index.html for non-file paths
        try {
          const indexPath = join(uiDir, 'index.html')
          const content = await readFile(indexPath)
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Content-Length': content.length,
            'Access-Control-Allow-Origin': '*',
          })
          res.end(content)
          return
        } catch {
          // No index.html available
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    } catch (error) {
      backstopServerError(res, req, error)
    }
  })

  // Bytes Node's own parser rejects never reach the listener above, and an unhandled `clientError`
  // is an uncaught error on the server. Answering it in fixed bytes keeps that class inside the
  // same posture as the rest of the enumeration.
  server.on('clientError', (_error, socket) => {
    if (socket.destroyed) return
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    socket.destroy()
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    // SYNCHRONOUS, so a throw here is an uncaught EXCEPTION the listener's backstop cannot reach.
    // The guarded parse is the only thing standing between `GET //%` with an `Upgrade` header and a
    // dead process; `undefined` takes this handler's existing refusal idiom.
    const url = tryParseRequestUrl(request)
    if (url === undefined) {
      socket.destroy()
      return
    }
    if (url.pathname === '/api/live-editor/ws') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) {
        socket.destroy()
        return
      }
      const session = sessionManager.getSession(sessionId)
      if (!session) {
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        session.clearIdleTimer()
        const handler = createSessionHandler(session, () => {
          sessionManager.terminateSession(sessionId)
        }, (event) => {
          db.insertTokenEvent(event)
        }, testFileManager)
        handler(ws)
      })
    } else {
      socket.destroy()
    }
  })

  const gracefulShutdown = () => {
    sessionManager.cleanupAll()
  }
  process.on('SIGTERM', gracefulShutdown)
  process.on('SIGINT', gracefulShutdown)

  // 396-01 D-10: the `services.mcp` read, the endpoint resolution, the `node:http` MCP listener and
  // the `agent-qa.mcp.server.lifecycle` analytics that reported on it all lived here and are gone.
  // The config KEY itself is deliberately retained in `ServicesSchema` — that object is `.strict()`,
  // so deleting the key would make every existing project that declares `services.mcp` fail to parse
  // — see DELETION-INVENTORY.md's dated row for the disposition and its owner.
  const cleanupRuntimeResources = () => {
    jobQueue.stop()
    if (testRunner) {
      testRunner.killAll()
    }
    releaseAllMobileAppiumLeases('server-startup-error')
    appiumManager.shutdown()
    sessionManager.cleanupAll()
    db.close()
  }

  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      cleanupRuntimeResources()
      reject(err)
    }
    server.once('error', onError)
    server.listen(port, () => {
      server.off('error', onError)
      console.log(`Dashboard running at http://localhost:${port}`)
      resolve({
        server,
        port,
        close: () => {
          jobQueue.stop()
          if (testRunner) {
            testRunner.killAll()
          }
          releaseAllMobileAppiumLeases('server-close')
          appiumManager.shutdown()
          sessionManager.cleanupAll()
          server.close()
          db.close()
        },
      })
    })
  })
}
