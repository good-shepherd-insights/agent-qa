// Types for `401-11-capture-parity.mjs`, hand-written because the generator is plain ESM.
//
// IT IS A DECLARATION RATHER THAN A `.ts` SOURCE for one reason: the generator has to run under
// bare `node` on the PRE-extraction tree (`node scripts/401-11-capture-parity.mjs --write`), which
// rules out a TypeScript module — and it has to be IMPORTED by the parity cell so the golden and
// every later reading share ONE scrubber rather than two matching implementations.

export declare const REPO_ROOT: string
export declare const CLI_DIST: string
export declare const PARITY_GOLDEN_PATH: string

export interface ParityInvocation {
  readonly id: string
  readonly args: readonly string[]
}

export declare const PARITY_INVOCATIONS: readonly ParityInvocation[]

export interface ScrubContext {
  readonly project: string
  readonly home?: string
  readonly tmp: string
  readonly repoRoot: string
  readonly targetOrigin?: string
}

export declare function scrubTranscript(text: string, context: ScrubContext): string

export interface ParityFixture {
  readonly project: string
  readonly home: string
}

export declare function createParityFixture(origin: string): ParityFixture

/** The six discriminators, for one invocation. */
export interface ParityReading {
  readonly id: string
  readonly args: readonly string[]
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly eventTypes: readonly string[]
  readonly targetHits: readonly string[]
  readonly runDirFiles: readonly string[]
}

export interface ParityGolden {
  readonly capturedAt: string
  readonly readings: readonly ParityReading[]
}

export declare function captureInvocation(invocation: ParityInvocation): Promise<ParityReading>
export declare function captureParityReadings(): Promise<ParityReading[]>
/**
 * A run-directory member added on purpose after the golden was captured (405-02 onward).
 * See the generator for why this exists and what it deliberately does not weaken.
 */
export interface PostGoldenRunDirAddition {
  readonly file: string
  readonly addedBy: string
  readonly reason: string
}

export declare const POST_GOLDEN_RUN_DIR_ADDITIONS: readonly PostGoldenRunDirAddition[]
export declare function withoutDeclaredRunDirAdditions(files: readonly string[]): string[]
export declare function staleDeclaredAdditions(
  observedFiles: readonly string[],
): readonly PostGoldenRunDirAddition[]

export declare function assertGoldenNonVacuous(golden: ParityGolden): ParityGolden
export declare function loadGolden(): ParityGolden
