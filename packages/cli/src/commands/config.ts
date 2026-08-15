import { Command } from 'commander'
import pc from 'picocolors'
import { parseDocument, Document } from 'yaml'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { isCredentialEntry } from '@vostride/agent-qa-agent'

import {
  ConfigFileNotFoundError,
  ConfigFileNotYamlError,
  formatConfigDebug,
  loadConfigFile,
  loadEnvOverrides,
  loadRequiredConfigFile,
  mergeConfigs,
} from '../config.js'

const DEFAULT_CONFIG_FILE = 'agent-qa.config.yaml'

/**
 * The path the person named, read off the ROOT program (395-24 · WR-03).
 *
 * Both verbs used to hardcode `'agent-qa.config.yaml'` while the root program had carried
 * `--config <path>` all along, so `agent-qa --config staging.yaml config set version 9` reported
 * `✓ version = 9 saved to agent-qa.config.yaml` and modified the file the person was explicitly
 * steering away from. A SILENT WRONG-FILE WRITE is the worst shape this bug takes: nothing in the
 * output said which file had actually changed.
 *
 * `config set` and `config show` are NESTED subcommands (`program -> config -> set`), so unlike
 * `ask.ts`'s `globalOptions` a single `.parent` hop lands on the `config` command, not the program.
 * Walking the chain to the root is the same derivation, generalized — and it is the whole chain
 * rather than two hops so a later regrouping of the verbs cannot silently reintroduce the default.
 *
 * AND IT ANSWERS BOTH FACTS AT ONCE (395-27 · WR-02). `showAction` needs to know not only WHICH
 * path resolved but whether the person NAMED it, because those two roads take opposite postures on
 * a file that is not there: a named file that is absent is a refusal, and a project that declares
 * no config at all is a truthful empty table. A second walk of the command chain to answer the
 * second half would be a second producer of the same fact, and this file's own comment above argues
 * against exactly that — so the walk stays ONE walk with TWO callers.
 *
 * EXPLICITNESS IS THE OPTION'S SOURCE, NOT WHETHER THE VALUE IS DEFINED. `cli.ts:43` declares
 * `.option('--config <path>', …, 'agent-qa.config.yaml')` WITH A DEFAULT, so `opts().config` is a
 * non-empty string in every invocation ever made — reading `!== undefined` answers "always yes" and
 * pushes the refusal onto every zero-config project in the world. Measured, not reasoned: the first
 * revision of this function did exactly that, and `config show` in an empty directory printed
 * `Config file not found: agent-qa.config.yaml` at exit 1. Commander's `getOptionValueSource`
 * distinguishes `'default'` from `'cli'`, which is the fact actually being asked for. The `??`
 * below is unreachable while that default stands and is kept so removing the default is not also a
 * silent change of path.
 */
function rootConfigPath(command: Command): { readonly path: string; readonly explicit: boolean } {
  let node: Command = command
  while (node.parent) node = node.parent
  const supplied = node.opts<{ config?: string }>().config
  const source = node.getOptionValueSource('config')
  return {
    path: supplied ?? DEFAULT_CONFIG_FILE,
    explicit: supplied !== undefined && source !== undefined && source !== 'default',
  }
}

/**
 * THE OTHER REPORT-NOT-CRASH SEAM (395-27 · WR-01), a SIBLING of `refuseCredentialWrite` and
 * deliberately not routed through it.
 *
 * The seam below carries three credential-specific sentences — the refusal plus two lines telling
 * the person which auth verb to use instead — and a filesystem fault has nothing to do with any of
 * them. Sharing the function would mean either printing auth advice at someone whose problem is a
 * typo in a directory name, or parameterizing those sentences away and leaving the credential seam
 * a shell. So: two reporters, one shape, and the shape is what matters — a fault the person can act
 * on, and a NON-ZERO exit, because `agent-qa config set x y && echo ok` printing `ok` after a write
 * that did not happen is the same invisible-to-automation failure 395-24 · WR-02 closed.
 *
 * ONLY THE ERROR'S `code`, NEVER THE ERROR. Node's own message interpolates the RESOLVED ABSOLUTE
 * path (`open '/var/folders/…/sub/staging.yaml'`) and its default printer appends the internal
 * frame list; the path rendered here is the one the person TYPED and nothing else (WR-07).
 */
function reportConfigFileFailure(verb: 'read' | 'write', configPath: string, err: unknown): void {
  const code = (err as NodeJS.ErrnoException).code ?? `${verb} failed`
  console.error(pc.red(`Could not ${verb} ${configPath}: ${code}`))
  process.exitCode = 1
}

/**
 * THE ONE REFUSAL SEAM (395-24 · WR-02). Every credential-write refusal in this file leaves through
 * here, and it leaves NON-ZERO.
 *
 * A refusal that exits 0 is a security action invisible to automation:
 * `agent-qa config set apiToken "$SECRET" && echo ok` printed `ok` while the write had been refused,
 * and no CI step could distinguish a refused credential write from a successful ordinary one. The
 * arms are routed through one function rather than each setting `process.exitCode` beside its own
 * `console.error`, because a guard applied per-arm is exactly how this project has left a sibling
 * open three rounds running — (K4c) pins the three arms as a relation for the same reason.
 */
function refuseCredentialWrite(reason: string): void {
  console.error(pc.red(reason))
  console.error('Use agent-qa auth set --config <name> --type api-key|bearer-token for compatible or Gemini configs.')
  console.error('Use plugins.auth plus the dashboard auth flow for subscription configs.')
  process.exitCode = 1
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}

function plainPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function getValue(key: string, providedValue: string | undefined): Promise<string | null> {
  if (providedValue !== undefined) return providedValue

  if (process.stdin.isTTY) {
    return plainPrompt(`Enter value for ${key}: `)
  }
  return readStdin()
}

async function setAction(key: string, value: string | undefined, command: Command): Promise<void> {
  // THE NAME ARM, ON THE ONE PREDICATE (395-20 · F-03). This file used to own a private
  // `SENSITIVE_KEYS` set, and that private set was the defect: it lacked `apitoken`, so
  // `config set apiToken sk-…` was accepted and written into the committed yaml — and the render
  // side, which had no predicate at all, then printed the value back. There is now ONE answer to
  // "is this a credential", imported by both sides, so they cannot drift apart again.
  //
  // STILL BEFORE `getValue`, deliberately: a key that says credential is refused without ever
  // prompting for or reading the secret, exactly as it did before.
  if (isCredentialEntry(key, undefined)) {
    refuseCredentialWrite('Credential values are not written by config set.')
    return
  }

  const resolved = await getValue(key, value)
  if (!resolved) {
    console.error(pc.red('No value provided.'))
    return
  }

  // THE VALUE ARM, and the reason this fix is a composition rather than a longer list. A key-name
  // set can only refuse what it can NAME (393): widening it closes `apiToken` and reopens under the
  // next name nobody listed. This second arm asks what the VALUE looks like, through the same
  // guardrail detector families the proposal scan uses, so a credential pasted under any key at all
  // is refused here. It sits after `getValue` because the value can arrive from stdin or a prompt.
  if (isCredentialEntry(key, resolved)) {
    refuseCredentialWrite('That value is shaped like a credential, and credential values are not written by config set.')
    return
  }

  const { path: configPath } = rootConfigPath(command)
  let doc: Document
  try {
    const content = await readFile(configPath, 'utf-8')
    doc = parseDocument(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      doc = new Document({})
    } else {
      // AND THE READ REPORTS TOO, not only the write below it. `--config <a directory>` produced
      // `EISDIR` here and this arm rethrew it into the same default printer the write did — the
      // same crash, on the same verb, in the same function, one guard away. A guard given to one
      // sibling and not the other is the shape this arc has now filed six times (388/390/392/395),
      // and the two siblings here are eleven lines apart.
      reportConfigFileFailure('read', configPath, err)
      return
    }
  }

  doc.setIn(key.split('.'), resolved)
  try {
    await writeFile(configPath, doc.toString())
  } catch (err: unknown) {
    // THE FROZEN ITEM (395-27 · WR-01). The read above was guarded and this was bare, so a
    // person-supplied path with a directory that does not exist ended the process as an uncaught
    // rejection: `node:internal/fs/promises:642`, the absolute resolved path, and the frame list.
    // The success line below is NOT reached — a write that did not happen does not report one.
    reportConfigFileFailure('write', configPath, err)
    return
  }
  // THE SENTENCE NAMES THE FILE THAT CHANGED, not the default. Rendered exactly as the person typed
  // it (WR-07's discipline: a person-facing path is the one they can read), so the unflagged road
  // still says `agent-qa.config.yaml` and the flagged road says what it actually wrote.
  console.log(pc.green(`\u2713 ${key} = ${resolved} saved to ${configPath}`))
}

async function showAction(command: Command): Promise<void> {
  // THE OP REPORTS, IT DOES NOT CRASH (395-16 · CR-01). This await was bare, so an unreadable
  // committed config left the command as an uncaught rejection and Node's default printer rendered
  // the error with its whole cause chain — the one road a person reaches this error on was also the
  // one road that printed the most. The typed arm answers the error's own position-only sentence
  // and exits 1. (395-16 added "anything else rethrows: a filesystem fault is not this guard's
  // subject" — still true of the PARSE guard, and 395-27 gave the filesystem fault its own guard
  // below rather than leaving it to the printer.)
  //
  // AND IT DOES NOT DESCRIBE A FILE THAT IS NOT THERE (395-27 · WR-02). `loadConfigFile` swallows
  // `ENOENT` and answers `{}`, which is the RIGHT answer for a project that declares no config and
  // the WRONG one for a file the person explicitly named: `--config nope.yaml config show` printed
  // `(no config values)` at exit 0 — a read the person will believe they performed. So the loader
  // is chosen by whether the path was SUPPLIED, and the refusal happens before any table is
  // composed. `loadRequiredConfigFile` already owns the sentence for this fact and the live lane
  // matches it verbatim; minting a second wording for the same fact is how two surfaces start
  // disagreeing about one file.
  //
  // THE UNFLAGGED ROAD IS UNTOUCHED, on purpose and pinned by (W9-control): a project that
  // genuinely declares no configuration is not being lied to by an empty table, and widening the
  // refusal there would change behaviour in every zero-config project and in the live lane.
  const { path: configPath, explicit } = rootConfigPath(command)
  let fileConfig: unknown
  try {
    fileConfig = explicit
      ? await loadRequiredConfigFile(configPath)
      : await loadConfigFile(configPath)
  } catch (err: unknown) {
    if (err instanceof ConfigFileNotYamlError || err instanceof ConfigFileNotFoundError) {
      console.error(pc.red(err.message))
      process.exitCode = 1
      return
    }
    // A NON-ENOENT READ FAULT REPORTS RATHER THAN CRASHING, for `setAction`'s reason: 395-16 wrote
    // "a filesystem fault is not this guard's subject" about the PARSE guard, and that is still
    // true — it is this one's. `--config <a directory>` reached Node's default printer here too.
    if (typeof (err as NodeJS.ErrnoException).code === 'string') {
      reportConfigFileFailure('read', configPath, err)
      return
    }
    throw err
  }
  const envOverrides = loadEnvOverrides()
  // Merge env into file config (3-layer: file+env is the global config)
  const globalConfig = mergeConfigs(fileConfig, envOverrides, {})
  const table = formatConfigDebug(globalConfig, {}, {})
  console.log(pc.bold('\nResolved Configuration:\n'))
  console.log(table)
  console.log()
}

export function createConfigCommand(): Command {
  const cmd = new Command('config').description('Manage configuration')

  // THE ARITY IS SPELLED OUT AT THE SEAM, ON PURPOSE. Commander invokes an action with
  // `(...declaredArguments, options, command)`, and WR-01 was exactly this arity read wrong one file
  // over: `validate.ts` bound `(files, command)` for an argument-bearing command and silently held
  // the OPTIONS object where it expected the Command. Handing `.action` a bare function reference
  // hides that count behind the handler's own signature; an explicit arrow puts it where a reader
  // of the wiring can check it against the `.command(...)` string on the line above.
  cmd
    .command('set <key> [value]')
    .description('Set a config value')
    .action((key: string, value: string | undefined, _options: unknown, command: Command) =>
      setAction(key, value, command))

  cmd
    .command('show')
    .description('Show resolved config with source attribution')
    .action((_options: unknown, command: Command) => showAction(command))

  return cmd
}
