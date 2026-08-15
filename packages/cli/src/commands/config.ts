import { Command } from 'commander'
import pc from 'picocolors'
import { parseDocument, Document } from 'yaml'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { isCredentialEntry } from '@vostride/agent-qa-agent'

import {
  ConfigFileNotYamlError,
  formatConfigDebug,
  loadConfigFile,
  loadEnvOverrides,
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
 */
function rootConfigPath(command: Command): string {
  let node: Command = command
  while (node.parent) node = node.parent
  return node.opts<{ config?: string }>().config ?? DEFAULT_CONFIG_FILE
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

  const configPath = rootConfigPath(command)
  let doc: Document
  try {
    const content = await readFile(configPath, 'utf-8')
    doc = parseDocument(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      doc = new Document({})
    } else {
      throw err
    }
  }

  doc.setIn(key.split('.'), resolved)
  await writeFile(configPath, doc.toString())
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
  // and exits 1. Anything else rethrows: a filesystem fault is not this guard's subject.
  let fileConfig: unknown
  try {
    fileConfig = await loadConfigFile(rootConfigPath(command))
  } catch (err: unknown) {
    if (err instanceof ConfigFileNotYamlError) {
      console.error(pc.red(err.message))
      process.exitCode = 1
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
