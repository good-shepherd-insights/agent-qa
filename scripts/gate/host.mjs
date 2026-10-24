import { spawnSync } from 'node:child_process'
import { existsSync as defaultExists, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, cpus, loadavg, release, type } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const GATE_ENV = { CI: 'true', DO_NOT_TRACK: '1' }

const PNPM_PIN = '10.6.1'
const CHROMIUM_HINT = 'pnpm --filter @vostride/agent-qa-web exec playwright install chromium'
const PROCESS_KEYWORDS = ['chrom', 'headless_shell', 'vitest', 'turbo', 'agent-qa']

export function defaultExec(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...GATE_ENV },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.error ? 127 : result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? result.error.message : result.stderr ?? '',
  }
}

function major(version) {
  return Number.parseInt(String(version ?? '').replace(/^v/, ''), 10)
}

function probeVersion(exec, command, args, cwd) {
  const result = exec(command, args, { cwd })
  if (result.status !== 0) return null
  return `${result.stdout} ${result.stderr}`.match(/\d+(\.\d+)+/)?.[0] ?? null
}

export function preflight({
  exec = defaultExec,
  cwd,
  nodeVersion = process.versions.node,
  platform = process.platform,
} = {}) {
  const git = probeVersion(exec, 'git', ['--version'], cwd)
  const pnpm = probeVersion(exec, 'pnpm', ['--version'], cwd)
  const expect = probeVersion(exec, 'expect', ['-v'], cwd)
  const python = probeVersion(exec, 'python3', ['--version'], cwd)
  const required = [
    { tool: 'git', version: git, ok: git !== null, hint: 'brew install git', need: 'any' },
    {
      tool: 'pnpm',
      version: pnpm,
      ok: major(pnpm) === 10,
      hint: `corepack enable && corepack prepare pnpm@${PNPM_PIN} --activate`,
      need: '10.x',
    },
    {
      tool: 'node',
      version: `v${nodeVersion}`,
      ok: major(nodeVersion) >= 24,
      hint: 'nvm install 24',
      need: '>= 24',
    },
    {
      tool: 'expect',
      version: expect,
      ok: expect !== null,
      hint: 'brew install expect',
      need: 'any',
    },
    {
      tool: 'python3',
      version: python,
      ok: python !== null,
      hint: 'brew install python3',
      need: 'any',
    },
  ]

  const adb = exec('adb', ['devices'], { cwd })
  const android =
    adb.status === 0 &&
    adb.stdout
      .split('\n')
      .slice(1)
      .some(line => /\sdevice$/.test(line.trim()))
  const simctl =
    platform === 'darwin' ? exec('xcrun', ['simctl', 'list', 'devices', 'booted'], { cwd }) : null
  const ios = simctl !== null && simctl.status === 0 && /\(Booted\)/.test(simctl.stdout)

  const failed = required.filter(entry => !entry.ok)
  const describe = entry =>
    `${entry.tool} ${entry.version ?? 'not found'} (needs ${entry.need}): ${entry.hint}`
  const message = failed.map(describe).join('\n')
  return {
    ok: failed.length === 0,
    required: required.map(({ need, ...entry }) => entry),
    optional: [
      { platform: 'android', present: android },
      { platform: 'ios', present: ios },
    ],
    message,
  }
}

function loadPlaywright(root) {
  const require = createRequire(join(root, 'packages/web/package.json'))
  const manifest = require.resolve('playwright-core/package.json')
  const { browsers } = JSON.parse(readFileSync(join(dirname(manifest), 'browsers.json'), 'utf8'))
  const playwright = require('playwright-core')
  const executables = {}
  for (const name of ['chromium', 'firefox', 'webkit']) {
    try {
      executables[name] = playwright[name].executablePath()
    } catch {
      executables[name] = null
    }
  }
  return { browsers, executables }
}

export function chromiumCheck({ root, load = loadPlaywright, exists = defaultExists } = {}) {
  let loaded
  try {
    loaded = load(root)
  } catch (error) {
    return {
      required: { tool: 'playwright-chromium', version: null, ok: false, hint: CHROMIUM_HINT },
      optional: [
        { platform: 'firefox', present: false },
        { platform: 'webkit', present: false },
      ],
      chromium: null,
      error: error.message,
    }
  }
  const browser = loaded.browsers.find(entry => entry.name === 'chromium')
  const chromium = browser
    ? { revision: browser.revision, browserVersion: browser.browserVersion }
    : null
  const present = name => Boolean(loaded.executables[name]) && exists(loaded.executables[name])
  return {
    required: {
      tool: 'playwright-chromium',
      version: chromium ? `${chromium.revision} (${chromium.browserVersion})` : null,
      ok: chromium !== null && present('chromium'),
      hint: CHROMIUM_HINT,
    },
    optional: [
      { platform: 'firefox', present: present('firefox') },
      { platform: 'webkit', present: present('webkit') },
    ],
    chromium,
  }
}

function lastLine(text) {
  return text.trim().split('\n').at(-1)?.trim() || null
}

export function describeEnvironment({ root, exec = defaultExec, sha, clonePath, chromium } = {}) {
  const pnpm = exec('pnpm', ['--version'], { cwd: root })
  const turbo = exec('pnpm', ['exec', 'turbo', '--version'], { cwd: root })
  return {
    node: process.version,
    pnpm: pnpm.status === 0 ? lastLine(pnpm.stdout) : null,
    turbo: turbo.status === 0 ? lastLine(turbo.stdout) : null,
    chromium: chromium ?? null,
    os: { type: type(), release: release(), arch: arch() },
    gateEnv: { ...GATE_ENV },
    sha,
    clonePath,
  }
}

function psRows(text, pattern) {
  return text
    .split('\n')
    .map(line => line.match(pattern))
    .filter(Boolean)
}

export function machineSnapshot({ exec = defaultExec, selfPid = process.pid } = {}) {
  // comm and args come from separate calls: macOS truncates comm to 16 characters unless it is
  // the last column.
  const comm = psRows(exec('ps', ['-Ao', 'pid=,ppid=,comm=']).stdout, /^\s*(\d+)\s+(\d+)\s+(.+)$/)
  const args = new Map(
    psRows(exec('ps', ['-Ao', 'pid=,args=']).stdout, /^\s*(\d+)\s+(.*)$/).map(match => [
      Number(match[1]),
      match[2],
    ]),
  )
  const rows = comm.map(match => ({
    pid: Number(match[1]),
    ppid: Number(match[2]),
    comm: match[3],
  }))
  const self = rows.find(row => row.pid === selfPid)
  const excluded = new Set([selfPid, self?.ppid])
  const processes = []
  for (const row of rows) {
    if (excluded.has(row.pid)) continue
    const text = `${row.comm} ${args.get(row.pid) ?? ''}`.toLowerCase()
    const keyword = PROCESS_KEYWORDS.find(word => text.includes(word))
    if (keyword) processes.push({ pid: row.pid, exe: basename(row.comm.trim()), keyword })
  }
  return { cpus: cpus().length, load: loadavg(), processes }
}
