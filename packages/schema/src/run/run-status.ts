export type RunStatus = 'passed' | 'failed' | 'healed' | 'timeout' | 'cancelled'

export type ExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'
