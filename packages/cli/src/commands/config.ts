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

/** The two lines every refusal in this file ends with — one road out, whichever arm fired. */
function printCredentialGuidance(): void {
  console.error('Use agent-qa auth set --config <name> --type api-key|bearer-token for compatible or Gemini configs.')
  console.error('Use plugins.auth plus the dashboard auth flow for subscription configs.')
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

async function setAction(key: string, value: string | undefined): Promise<void> {
  // THE NAME ARM, ON THE ONE PREDICATE (395-20 · F-03). This file used to own a private
  // `SENSITIVE_KEYS` set, and that private set was the defect: it lacked `apitoken`, so
  // `config set apiToken sk-…` was accepted and written into the committed yaml — and the render
  // side, which had no predicate at all, then printed the value back. There is now ONE answer to
  // "is this a credential", imported by both sides, so they cannot drift apart again.
  //
  // STILL BEFORE `getValue`, deliberately: a key that says credential is refused without ever
  // prompting for or reading the secret, exactly as it did before.
  if (isCredentialEntry(key, undefined)) {
    console.error(pc.red('Credential values are not written by config set.'))
    printCredentialGuidance()
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
    console.error(pc.red('That value is shaped like a credential, and credential values are not written by config set.'))
    printCredentialGuidance()
    return
  }

  const configPath = 'agent-qa.config.yaml'
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
  console.log(pc.green(`\u2713 ${key} = ${resolved} saved to agent-qa.config.yaml`))
}

async function showAction(): Promise<void> {
  // THE OP REPORTS, IT DOES NOT CRASH (395-16 · CR-01). This await was bare, so an unreadable
  // committed config left the command as an uncaught rejection and Node's default printer rendered
  // the error with its whole cause chain — the one road a person reaches this error on was also the
  // one road that printed the most. The typed arm answers the error's own position-only sentence
  // and exits 1. Anything else rethrows: a filesystem fault is not this guard's subject.
  let fileConfig: unknown
  try {
    fileConfig = await loadConfigFile('agent-qa.config.yaml')
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

  cmd
    .command('set <key> [value]')
    .description('Set a config value')
    .action(setAction)

  cmd
    .command('show')
    .description('Show resolved config with source attribution')
    .action(showAction)

  return cmd
}
