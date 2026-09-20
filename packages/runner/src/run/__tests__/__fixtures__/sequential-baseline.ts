// GENERATED — the pre-refactor sequential event stream of `run-shell.concurrency.test.ts`'s
// baseline scenario, captured 2026-08-24 against the `for`-loop shell at 7908bd34 BEFORE the
// bounded member pool landed (402-02 Task 1). This file IS the parity control: the pool at
// workers=1 must reproduce it verbatim. Regenerate ONLY with a recorded reason —
// `AGENT_QA_CAPTURE_BASELINE=1 pnpm --filter @vostride/agent-qa-runner exec vitest run \
//   src/run/__tests__/run-shell.concurrency.test.ts` — because regenerating it against the
// code under test is exactly how a differential control becomes self-certifying.
export const SEQUENTIAL_BASELINE: ReadonlyArray<{
  seq: number
  type: string
  runId: string
  payload: unknown
}> = [
  {
    "seq": 1,
    "type": "runStarted",
    "runId": "run-baseline",
    "payload": {
      "busSchemaVersion": 1,
      "scope": {
        "tier": "suite",
        "key": "checkout"
      },
      "executionContext": "local-headless",
      "buildOrdinal": 7,
      "configDigests": {
        "suiteConfigDigest": "suite-d",
        "testConfigDigest": "test-d"
      },
      "memberTestCount": 4
    }
  },
  {
    "seq": 2,
    "type": "testStarted",
    "runId": "run-baseline",
    "payload": {
      "testId": "alpha",
      "testIndex": 0,
      "name": "alpha test",
      "filePath": "alpha.test.ts",
      "suiteId": "s1",
      "suiteName": "suite one",
      "suiteIndex": 0,
      "suiteTotal": 1,
      "totalSteps": 1
    }
  },
  {
    "seq": 3,
    "type": "testFinished",
    "runId": "run-baseline",
    "payload": {
      "testId": "alpha",
      "testIndex": 0,
      "outcome": "passed",
      "durationMs": 1
    }
  },
  {
    "seq": 4,
    "type": "testStarted",
    "runId": "run-baseline",
    "payload": {
      "testId": "bravo",
      "testIndex": 1,
      "name": "bravo test",
      "filePath": "bravo.test.ts",
      "suiteId": "s1",
      "suiteName": "suite one",
      "suiteIndex": 0,
      "suiteTotal": 1,
      "totalSteps": 1
    }
  },
  {
    "seq": 5,
    "type": "testFinished",
    "runId": "run-baseline",
    "payload": {
      "testId": "bravo",
      "testIndex": 1,
      "outcome": "failed",
      "durationMs": 1
    }
  },
  {
    "seq": 6,
    "type": "testFinished",
    "runId": "run-baseline",
    "payload": {
      "testId": "charlie",
      "testIndex": 2,
      "outcome": "skipped",
      "recording": {
        "state": "absent",
        "reason": "not-captured"
      }
    }
  },
  {
    "seq": 7,
    "type": "testStarted",
    "runId": "run-baseline",
    "payload": {
      "testId": "delta",
      "testIndex": 3,
      "name": "delta test",
      "filePath": "delta.test.ts",
      "totalSteps": 1
    }
  },
  {
    "seq": 8,
    "type": "testFinished",
    "runId": "run-baseline",
    "payload": {
      "testId": "delta",
      "testIndex": 3,
      "outcome": "passed",
      "durationMs": 1
    }
  },
  {
    "seq": 9,
    "type": "verdict",
    "runId": "run-baseline",
    "payload": {
      "verdict": "failed"
    }
  },
  {
    "seq": 10,
    "type": "runFinished",
    "runId": "run-baseline",
    "payload": {
      "aggregateVerdict": "failed",
      "disposition": "detached",
      "finalSeq": 10
    }
  }
]
