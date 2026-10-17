import './color-posture.js'

// 2026-10-18 (444-14, D-47): a variable specifier keeps the bundler from inlining the CLI, so no
// static import evaluates (and reads the environment) before the posture above.
const main = './cli-main.js'

void import(main).catch((error: unknown) => {
  console.error(`Framework error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
