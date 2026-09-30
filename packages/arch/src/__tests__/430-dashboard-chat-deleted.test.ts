/**
 * THE DASHBOARD CHAT DELETION CENSUS (PXH-SURF-01, PXH-SURF-03; 430 D-11) — no hidden second Chat
 * remains in the dashboard UI, the dashboard server or the door's composition, tests and comments
 * included.
 *
 * WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 430 deleted the dashboard's
 * conversational surface whole: the page, its transcript and markdown renderer, the entity cards,
 * the browser clients, the server's conversation routes and streaming machinery, the host members
 * only that door read, the session-surface tag the composition wrote, and the markdown parser the
 * renderer pulled in. Every one of those is a thing that got REMOVED, and removal has a failure mode
 * a passing suite cannot see: the thing coming back. Nothing in a green run fails when a route
 * prefix is re-added to a dispatch table, when a page is re-mounted, or when a parser import
 * returns — a suite that proves what IS there is satisfied by a tree that holds more. So each
 * removed name, path, file and dependency has a cell here that REDs by name on its return.
 *
 * THE UNIVERSES, BY PATH RULE. Three, and none is a list of files:
 *   - the UI: every `.ts`/`.tsx` under the dashboard UI's `src`, tests included;
 *   - the server: every `.ts`/`.tsx` under the dashboard server's `src`, tests included, with the
 *     production subset split off by the 412 path rule (no `__tests__` path segment and no `.test`
 *     or `.test-d` suffix) and never by naming a file;
 *   - the door: the one CLI file that composes the dashboard's host, because the door's own tests
 *     are gone and a composition wiring could otherwise return unseen.
 * A fourth, one-file universe is the UI's ownership contract, whose dependency list may not name the
 * parser. Most needles are refused in all three universes. The UI's component, client, route and
 * copy names are refused in the UI only, and the host's result fold in the server and door only,
 * because the CLI's own conversation command keeps a helper of that name outside these trees.
 * The roots are declared as a URL beside this file plus literal directory strings, the shape the
 * mutation engine's arrival proof can follow, so a planted return in any production file under them
 * provably reaches this census.
 *
 * COMMENTS COUNT. Needles match the raw source text, line by line, as decoded UTF-8, with a plain
 * substring test. No tokenizer, syntax tree or comment stripper stands between the tree and the
 * verdict: a retirement note that spells a removed name is a hit exactly like a live reference,
 * because the promise is "this string is not in the tree", not "no code reads it". Surviving prose
 * names the CONCEPT, never the spelling. A cell below asserts the comment property directly.
 *
 * WHY THE NEEDLES ARE COMPOUNDS. The bare words have legitimate homonyms in these trees: a model
 * vendor's product name, the feedback outcome that shares the parser's name, an icon, and the CLI
 * conversation's own fold helper. Each needle is a compound spelling whose count at rest was
 * measured as zero, so no homonym is accused and no filter is needed to spare one.
 *
 * THE TOLERATED NAMES ARE A POSITIVE CONTROL, NEVER A FILTER. D-11 keeps a short list of
 * chat-flavoured names the tree legitimately holds: the door's composition seams, the host seam, the
 * denial block and the entity route helper. (The confirm pieces and the router that served the
 * run-confirm rows were on it until 432-14 deleted them, D-14.) They are not excluded from anything. One cell asserts BY NAME that each
 * is present at rest in the production source of its universe, and another that no needle is a
 * substring of any of them, so no needle was ever narrowed around a kept name. A needle that
 * started matching a kept name would RED that cell rather than hide behind an exception.
 *
 * THIS FILE CANNOT MATCH ITSELF. Every needle is assembled at run time from two halves, and each
 * split is chosen so that neither half is a needle, so no whole token is spelled in this source —
 * the header prose included, which is why it names concepts and never spellings. The server's
 * closed-set type test spells the removed host members the same way, as template halves, and a
 * by-name cell below records that as deliberate rather than accidental. The last cell asserts the
 * property over this file's own bytes.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGES = new URL('../../../', import.meta.url)
const THIS_FILE = fileURLToPath(import.meta.url)

const UI_ROOT = 'dashboard-ui/src/'
const SERVER_ROOT = 'dashboard-server/src/'
const DOOR_FILE = 'cli/src/commands/dashboard.ts'
const CONTRACT_FILE = 'dashboard-ui/src/ownership-contract.ts'
const UI_MANIFEST = 'dashboard-ui/package.json'
const SERVER_CLOSED_SET_TYPE_TEST = 'dashboard-server/src/__tests__/430-chat-closed-sets.test-d.ts'

type Scope = 'all' | 'server-and-door' | 'ui' | 'contract'

interface NeedleEntry {
  readonly label: string
  readonly halves: readonly [string, string]
  readonly scope: Scope
}

const joined = (entry: NeedleEntry): string => entry.halves[0] + entry.halves[1]

// ---------------------------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------------------------

/** Refused in the UI, the server and the door alike. */
const EVERYWHERE: NeedleEntry[] = [
  { label: 'the deleted route prefix', halves: ['/api/', 'chat/'], scope: 'all' },
  { label: 'the turn response DTO', halves: ['ChatTurn', 'Response'], scope: 'all' },
  { label: 'the turn fold DTO', halves: ['ChatTurn', 'Fold'], scope: 'all' },
  {
    label: 'the host' + "'s ask-function id member",
    halves: ['agentAsk', 'FunctionId'],
    scope: 'all',
  },
  {
    label: 'the host' + "'s capability catalog reader",
    halves: ['readCapability', 'Catalog'],
    scope: 'all',
  },
  { label: 'the host' + "'s declaration lister", halves: ['listDecl', 'arations'], scope: 'all' },
  {
    label: 'the host' + "'s session-event subscription",
    halves: ['onSession', 'Event'],
    scope: 'all',
  },
  { label: 'the session-event fan-out', halves: ['SessionEvent', 'FanOut'], scope: 'all' },
  { label: 'the session-surface composition option', halves: ['sessionSur', 'face'], scope: 'all' },
  { label: 'the stream bounds table', halves: ['CHAT_STREAM_', 'BOUNDS'], scope: 'all' },
  { label: 'the streamed-event recorder', halves: ['recordStreamed', 'Event'], scope: 'all' },
  { label: 'the stream replay limit', halves: ['CHAT_STREAM_REPLAY_', 'LIMIT'], scope: 'all' },
  { label: 'the stream session limit', halves: ['CHAT_STREAM_SESSION_', 'LIMIT'], scope: 'all' },
  { label: 'the turn route constant', halves: ['CHAT_TURN_', 'ROUTE'], scope: 'all' },
  { label: 'the catalog route constant', halves: ['CHAT_CATALOG_', 'ROUTE'], scope: 'all' },
  {
    label: 'the capabilities route constant',
    halves: ['CHAT_CAPABILITIES_', 'ROUTE'],
    scope: 'all',
  },
  { label: 'the confirm route constant', halves: ['CHAT_CONFIRM_', 'ROUTE'], scope: 'all' },
  {
    label: 'the session-events route template',
    halves: ['CHAT_SESSION_EVENTS_', 'TEMPLATE'],
    scope: 'all',
  },
  { label: 'the route prefix constant', halves: ['CHAT_ROUTE_', 'PREFIX'], scope: 'all' },
  { label: 'the turn handler', halves: ['handle', 'Turn'], scope: 'all' },
  { label: 'the catalog handler', halves: ['handle', 'Catalog'], scope: 'all' },
  { label: 'the capabilities handler', halves: ['handle', 'Capabilities'], scope: 'all' },
  { label: 'the unavailable-door wording', halves: ['Chat is not ', 'available'], scope: 'all' },
  {
    label: 'the CLI conversation capability resolver',
    halves: ['resolveCliChat', 'Capabilities'],
    scope: 'all',
  },
]

/** Refused in the server and the door; the CLI conversation keeps its own helper of this name. */
const SERVER_AND_DOOR: NeedleEntry[] = [
  {
    label: 'the host' + "'s function-result fold",
    halves: ['foldFunction', 'Result'],
    scope: 'server-and-door',
  },
]

/** Refused in the UI only: its components, modules, clients, routes and copy. */
const UI_ONLY: NeedleEntry[] = [
  { label: 'the UI chat module import alias', halves: ['@/', 'chat/'], scope: 'ui' },
  { label: 'the session provider', halves: ['Chat', 'SessionProvider'], scope: 'ui' },
  { label: 'the session hook', halves: ['useChat', 'Session'], scope: 'ui' },
  { label: 'the panel component', halves: ['Chat', 'Panel'], scope: 'ui' },
  { label: 'the panel stem', halves: ['chat-', 'panel'], scope: 'ui' },
  { label: 'the panel data attribute', halves: ['data-chat-', 'panel'], scope: 'ui' },
  { label: 'the page component', halves: ['Chat', 'Page'], scope: 'ui' },
  { label: 'the transcript component', halves: ['Chat', 'Transcript'], scope: 'ui' },
  { label: 'the turn hook', halves: ['useChat', 'Turn'], scope: 'ui' },
  { label: 'the markdown renderer', halves: ['Chat', 'Markdown'], scope: 'ui' },
  { label: 'the observation markdown renderer', halves: ['Observation', 'Markdown'], scope: 'ui' },
  { label: 'the confirm bubble', halves: ['Confirm', 'Bubble'], scope: 'ui' },
  { label: 'the receipt row', halves: ['Receipt', 'Row'], scope: 'ui' },
  { label: 'the transcript module file', halves: ['chat-', 'transcript'], scope: 'ui' },
  { label: 'the markdown module file', halves: ['chat-', 'markdown'], scope: 'ui' },
  {
    label: 'the observation markdown module file',
    halves: ['observation-', 'markdown'],
    scope: 'ui',
  },
  { label: 'the session context module file', halves: ['chat-session-', 'context'], scope: 'ui' },
  { label: 'the turn hook module file', halves: ['use-chat-', 'turn'], scope: 'ui' },
  { label: 'the confirm bubble module file', halves: ['confirm-', 'bubble'], scope: 'ui' },
  { label: 'the receipt row module file', halves: ['receipt-', 'row'], scope: 'ui' },
  { label: 'the entity card element', halves: ['<Entity', 'Card'], scope: 'ui' },
  { label: 'the entity card call', halves: ['Entity', 'Card('], scope: 'ui' },
  { label: 'the entity card extractor', halves: ['entityCards', 'In'], scope: 'ui' },
  {
    label: 'the entity card action utterance',
    halves: ['entityCardAction', 'Utterance'],
    scope: 'ui',
  },
  { label: 'the entity card machine id', halves: ['entityCard', 'MachineId'], scope: 'ui' },
  { label: 'the entity card route helper', halves: ['entityCard', 'Route'], scope: 'ui' },
  { label: 'the turn client', halves: ['postChat', 'Turn'], scope: 'ui' },
  { label: 'the confirm answer client', halves: ['answerChat', 'Confirm'], scope: 'ui' },
  {
    label: 'the session-events subscription client',
    halves: ['subscribeToChat', 'SessionEvents'],
    scope: 'ui',
  },
  {
    label: 'the capability catalog client',
    halves: ['fetchChat', 'CapabilityCatalog'],
    scope: 'ui',
  },
  { label: 'the capability row type', halves: ['ChatCapability', 'Row'], scope: 'ui' },
  { label: 'the capability catalog type', halves: ['ChatCapability', 'Catalog'], scope: 'ui' },
  { label: 'the route map member access', halves: ['routes.', 'chat'], scope: 'ui' },
  { label: 'the route map key', halves: ["chat: '", "/chat'"], scope: 'ui' },
  { label: 'the router path', halves: ['path: "', 'chat"'], scope: 'ui' },
  { label: 'the dashboard remedy text table', halves: ['DASHBOARD_REMEDY_', 'TEXT'], scope: 'ui' },
  { label: 'the keep-open remedy sentence', halves: ['keep this ', 'chat open'], scope: 'ui' },
  {
    label: 'the new-session remedy sentence',
    halves: ['start a new ', 'chat session'],
    scope: 'ui',
  },
  { label: 'the parser import, double-quoted', halves: ['from "mar', 'ked"'], scope: 'ui' },
  { label: 'the parser import, single-quoted', halves: ["from 'mar", "ked'"], scope: 'ui' },
  { label: 'the presence frame name', halves: ['chat_', 'present'], scope: 'ui' },
]

/** The ownership contract's dependency list alone: the parser's quoted package name. */
const CONTRACT_ONLY: NeedleEntry[] = [
  { label: 'the parser in the ownership contract', halves: ["'mar", "ked'"], scope: 'contract' },
]

const EVERY_NEEDLE: NeedleEntry[] = [
  ...EVERYWHERE,
  ...SERVER_AND_DOOR,
  ...UI_ONLY,
  ...CONTRACT_ONLY,
]

/** The kept names (D-11), each with the universe whose production source must still spell it. */
// 2026-10-01 (432-14, D-14): the confirm vocabulary, the channel frames, the confirm router and its
// table are deleted with the run-confirm pair, so they leave this list rather than being excused.
const TOLERATED: ReadonlyArray<readonly [string, 'ui' | 'server' | 'door']> = [
  ['composeDashboardDoor', 'door'],
  ['composeDashboardAgentHost', 'door'],
  ['DASHBOARD_FUNCTION_CALLER', 'door'],
  ['DenialBlock', 'ui'],
  ['entityRefRoute', 'ui'],
  ['AgentHost', 'server'],
]

// ---------------------------------------------------------------------------------------------
// The universes
// ---------------------------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under a root, tests included, as a path relative to `packages/`. */
function listTree(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, PACKAGES), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (/\.tsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

const UI = listTree(UI_ROOT)
const SERVER = listTree(SERVER_ROOT)
const DOOR = [DOOR_FILE]
const CONTRACT = [CONTRACT_FILE]
const UI_PRODUCTION = UI.filter(isProduction)
const SERVER_PRODUCTION = SERVER.filter(isProduction)

const UNIVERSE_FOR: Record<Scope, readonly string[]> = {
  all: [...UI, ...SERVER, ...DOOR],
  'server-and-door': [...SERVER, ...DOOR],
  ui: UI,
  contract: CONTRACT,
}

const PRODUCTION_FOR = { ui: UI_PRODUCTION, server: SERVER_PRODUCTION, door: DOOR } as const

/** The directory rule: a path that lies under the UI's deleted conversation directory. */
const UI_CHAT_DIRECTORY = 'dashboard-ui/src/' + 'chat/'
const underUiChatDirectory = (path: string): boolean => path.includes(UI_CHAT_DIRECTORY)

const read = (file: string): string => readFileSync(new URL(file, PACKAGES), 'utf8')

interface Hit {
  file: string
  line: number
  text: string
}

/** The extractor. Raw text, line by line: a needle in a comment is a hit, by design. */
function findNeedle(needle: string, source: string, file: string): Hit[] {
  const hits: Hit[] = []
  source.split('\n').forEach((text, index) => {
    if (text.includes(needle)) hits.push({ file, line: index + 1, text: text.trim() })
  })
  return hits
}

function census(needle: string, universe: readonly string[]): string[] {
  return universe.flatMap((file) =>
    findNeedle(needle, read(file), file).map((hit) => `${hit.file}:${hit.line}: ${hit.text}`),
  )
}

describe('no hidden second Chat remains in the dashboard UI, server or door composition (PXH-SURF-01, PXH-SURF-03)', () => {
  // Lower bounds only: the tree grows, and a pinned total would measure the tree rather than the
  // scan. Measured at rest on 2026-09-28: UI 531 files (301 production), server 132 files (53
  // production), the door one file.
  it('UNIVERSE-LOWER-BOUNDS: each universe scans at least its measured floor, and each production subset is a strict one', () => {
    expect(UI.length, `the UI universe: ${UI.length} files`).toBeGreaterThanOrEqual(450)
    expect(UI_PRODUCTION.length).toBeGreaterThanOrEqual(250)
    expect(UI_PRODUCTION.length).toBeLessThan(UI.length)

    expect(SERVER.length, `the server universe: ${SERVER.length} files`).toBeGreaterThanOrEqual(110)
    expect(SERVER_PRODUCTION.length).toBeGreaterThanOrEqual(40)
    expect(SERVER_PRODUCTION.length).toBeLessThan(SERVER.length)

    expect(DOOR).toHaveLength(1)
    expect(read(DOOR_FILE).split('\n').length).toBeGreaterThan(100)

    expect(CONTRACT).toHaveLength(1)
    expect(UI).toContain(CONTRACT_FILE)
    expect(SERVER).toContain(SERVER_CLOSED_SET_TYPE_TEST)
  })

  it('NO-FILE-UNDER-THE-UI-CHAT-DIRECTORY: no scanned UI path lies under the deleted conversation directory', () => {
    const offenders = UI.filter(underUiChatDirectory)
    expect(
      offenders,
      `a file returned under the UI conversation directory:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  // The directory rule is asserted against synthetic paths, so it holds whether or not the tree
  // holds any of them: the UI directory is admitted, and the server's kept directory and the
  // relocated entity route helper are refused.
  it('CHAT-DIRECTORY-RULE-CONTROL: the rule admits a UI conversation file and refuses the server directory and the entity route helper', () => {
    const admitted = ['packages/dashboard-ui/src/chat/x.tsx']
    const refused = [
      'packages/dashboard-server/src/chat/host.ts',
      'packages/dashboard-ui/src/lib/entity-routes.ts',
    ]
    expect(
      admitted.filter((path) => !underUiChatDirectory(path)),
      'the rule dropped a UI conversation file',
    ).toEqual([])
    expect(refused.filter(underUiChatDirectory), 'the rule admitted a kept path').toEqual([])
  })

  it('TOLERATED-NAMES-PRESENT: every kept name is present at rest in the production source of its universe', () => {
    const absent = TOLERATED.filter(
      ([name, universe]) => !PRODUCTION_FOR[universe].some((file) => read(file).includes(name)),
    ).map(([name, universe]) => `${name} (${universe})`)
    expect(
      absent,
      `a kept name vanished; D-11's list must be revised by name: ${absent.join(', ')}`,
    ).toEqual([])
  })

  it('TOLERATED-NAMES-NOT-NEEDLES: no needle is a substring of any kept name', () => {
    const overlaps = EVERY_NEEDLE.flatMap((entry) =>
      TOLERATED.filter(([name]) => name.includes(joined(entry))).map(
        ([name]) => `${entry.label} in ${name}`,
      ),
    )
    expect(overlaps, `a needle would accuse a kept name: ${overlaps.join(', ')}`).toEqual([])
  })

  it('DASHBOARD-UI-DECLARES-NO-MARKDOWN-PARSER: the UI manifest lists no markdown parser in any dependency table', () => {
    const manifest = JSON.parse(read(UI_MANIFEST)) as Record<
      string,
      Record<string, string> | undefined
    >
    const parser = 'mar' + 'ked'
    const declaring = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].filter((table) => manifest[table]?.[parser] !== undefined)
    expect(declaring, `the UI manifest declares the parser in: ${declaring.join(', ')}`).toEqual([])
  })

  // The known-positive control. Every needle is planted in a synthetic source and must be found,
  // otherwise a typo'd needle reports zero hits forever and the census measures nothing.
  it('PLANTED-POSITIVE: finds every planted needle — the known-positive control for the extractor', () => {
    const labels = EVERY_NEEDLE.map((entry) => entry.label)
    expect(
      new Set(labels).size,
      'two needles share a label, so two cells would share a title',
    ).toBe(labels.length)
    for (const entry of EVERY_NEEDLE) {
      expect(
        entry.halves.every((half) => half.length > 0),
        `${entry.label} has an empty half`,
      ).toBe(true)
      const planted = ['const untouched = 1', `const planted = ${joined(entry)}`, '// tail'].join(
        '\n',
      )
      const hits = findNeedle(joined(entry), planted, 'synthetic/planted.ts')
      expect(hits.length, `the extractor could not find the planted ${entry.label}`).toBe(1)
      expect(hits[0]?.line).toBe(2)
    }
  })

  // A property nobody asserts drifts the first time somebody strips comments before scanning.
  it('COMMENTS-COUNT: counts a needle inside a comment as a hit', () => {
    for (const entry of EVERY_NEEDLE) {
      const commented = `// a retirement note naming ${joined(entry)} in prose`
      expect(
        findNeedle(joined(entry), commented, 'synthetic/commented.ts'),
        entry.label,
      ).toHaveLength(1)
      expect(
        findNeedle(joined(entry), `/* ${joined(entry)} */`, 'synthetic/block.ts'),
        entry.label,
      ).toHaveLength(1)
    }
  })

  for (const entry of EVERY_NEEDLE) {
    it(`no source or test spells ${entry.label}`, () => {
      const hits = census(joined(entry), UNIVERSE_FOR[entry.scope])
      expect(
        hits,
        `a removed dashboard conversation name returned (${entry.scope}):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  // 430-10's closed-set type test lives inside the server universe and names the removed host
  // members as template halves, the same construction as this file. That is deliberate: the
  // generated cells above prove it spells no joined needle, and this cell proves by name that it
  // still carries every split spelling, so the type-level bar and this census cover one another.
  it('SPLIT-SPELLING-ACCOUNTED: the server closed-set type test spells each removed host member only as template halves', () => {
    const text = read(SERVER_CLOSED_SET_TYPE_TEST)
    const hostMembers = EVERY_NEEDLE.filter((entry) => entry.label.startsWith('the host' + "'s "))
    expect(hostMembers).toHaveLength(5)
    const missing = hostMembers
      .filter(({ halves: [head, tail] }) => !text.includes(head + '${' + `'${tail}'` + '}'))
      .map((entry) => entry.label)
    expect(
      missing,
      `the type test no longer spells these as halves: ${missing.join(', ')}`,
    ).toEqual([])
    const joinedHits = hostMembers
      .filter((entry) => text.includes(joined(entry)))
      .map((entry) => entry.label)
    expect(joinedHits, `the type test spells these whole: ${joinedHits.join(', ')}`).toEqual([])
  })

  // This file is outside every universe, but a whole spelling here would still be an inventory
  // satisfying itself the moment a later phase widened a root to cover it.
  it('SELF-MATCH: spells none of its own needles — the inventory cannot be satisfied by this file', () => {
    const own = readFileSync(THIS_FILE, 'utf8')
    const selfHits = EVERY_NEEDLE.filter((entry) => own.includes(joined(entry))).map(
      (entry) => entry.label,
    )
    expect(
      selfHits,
      `this file spells a needle it forbids; build it from two halves: ${selfHits.join(', ')}`,
    ).toEqual([])
  })
})
