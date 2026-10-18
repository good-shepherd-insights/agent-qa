import './color-posture.js'

// 2026-10-18 (444-14, D-47): a variable specifier keeps the bundler from inlining the CLI, so no
// static import evaluates (and reads the environment) before the posture above.
const main = './cli-main.js'

void import(main).catch((error: unknown) => {
  console.error(`Framework error: ${error instanceof Error ? error.message : String(error)}`)
  // 2026-10-18 (444-27, D-62 WR-01): the stack follows the line, so a load-time or synchronous
  // CLI failure still names where it threw.
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exit(2)
})
