import { Command } from 'commander'
import { VERSION } from './index.js'
import {
  createAuthCommand,
  createAuthStateCommand,
  createCacheCommand,
  createConfigCommand,
  createCreateSuiteCommand,
  createCreateTestCommand,
  createDashboardCommand,
  createDaemonCommand,
  createDevicesCommand,
  createDoctorCommand,
  createEntitiesCommand,
  createEvalCommand,
  createDigestCommand,
  createAskCommand,
  createChatCommand,
  createFnCommand,
  createProposalsCommand,
  createInitCommand,
  createInstallBrowsersCommand,
  createInstallMobileDriversCommand,
  createKnowledgeCommand,
  createMcpCommand,
  createQueueCommand,
  createRunCommand,
  createServeCommand,
  createSkillsCommand,
  createValidateCommand,
} from './commands/index.js'
import { rejectRemovedCliSurface } from './removed-cli-surface.js'

rejectRemovedCliSurface()

const program = new Command()
program.enablePositionalOptions()

program
  .name('agent-qa')
  .description('The self-improving Agentic QA harness with Memory')
  .version(VERSION)

program
  .option('--config <path>', 'config file path', 'agent-qa.config.yaml')
  .option('--log-level <level>', 'log verbosity: silent|error|warn|info|debug')
  .option('--verbose', 'shorthand for --log-level debug')
  .option('--quiet', 'shorthand for --log-level silent')

program.addCommand(createRunCommand())
program.addCommand(createInitCommand())
program.addCommand(createInstallBrowsersCommand())
program.addCommand(createInstallMobileDriversCommand())

program.addCommand(createDoctorCommand())
program.addCommand(createDashboardCommand())
program.addCommand(createServeCommand())
program.addCommand(createMcpCommand())
program.addCommand(createConfigCommand())
program.addCommand(createQueueCommand())
program.addCommand(createKnowledgeCommand())
program.addCommand(createCacheCommand())
program.addCommand(createValidateCommand())
program.addCommand(createAuthCommand())
program.addCommand(createAuthStateCommand())
program.addCommand(createDevicesCommand())
program.addCommand(createEntitiesCommand())
program.addCommand(createEvalCommand())
program.addCommand(createCreateTestCommand())
program.addCommand(createCreateSuiteCommand())
program.addCommand(createSkillsCommand())
program.addCommand(createFnCommand())
// 392 D-01/D-24: the one-shot chat verb, registered beside `fn` because it is the same KIND of
// thing — a thin client that invokes one registered op through `invokeFunction`.
program.addCommand(createAskCommand())
// D-01's other surface. Two commands, ONE turn engine: the REPL and the one-shot verb differ in
// the session and the loop and in nothing else, which is why a routing change cannot be right in
// one of them and wrong in the other.
program.addCommand(createChatCommand())
// 391 D-17: the proposals inbox + grants decision surface, and the per-run digest on demand.
program.addCommand(createProposalsCommand())
program.addCommand(createDigestCommand())
program.addCommand(createDaemonCommand())

program.parse()

export { program }
