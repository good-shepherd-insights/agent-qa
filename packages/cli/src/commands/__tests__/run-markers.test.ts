// The `run` command's half of the 393 marker runway (WTST-06).
//
// `runs.start` executes a run by re-entering this command as a child process, so `--gate-run` and
// `--excluded-from-outcomes` are the only channel the two durable markers have into `RunConfig` and
// from there onto the handoff the outcome fold reads. What this file pins is the translation, and
// specifically the part a reasonable implementation gets wrong: a `false` is a refusal, never a
// synonym for absence. The carriers are typed `?: true`, `AnalyzeRunPayloadSchema` refuses a
// literal `false`, and a run whose handoff carried `gateRun: false` would be a run of a kind the
// vocabulary does not have.

import { describe, expect, it } from 'vitest'

import { runMarkers } from '../run.js'

describe('runMarkers — the two durable run markers as RunConfig fields (393, WTST-06)', () => {
  it('carries both markers when both flags are set', () => {
    expect(runMarkers({ gateRun: true, excludedFromOutcomes: true }))
      .toEqual({ gateRun: true, excludedFromOutcomes: true })
  })

  it('carries each marker on its own — they are DISTINCT axes (C8)', () => {
    // C8 ratifies that a gate-run still feeds curation, so "verify-before-present" and "keep this
    // run out of the outcome projection" are two decisions and a caller may take either alone.
    expect(runMarkers({ gateRun: true })).toEqual({ gateRun: true })
    expect(runMarkers({ excludedFromOutcomes: true })).toEqual({ excludedFromOutcomes: true })
  })

  it('leaves the fields ABSENT for an ordinary run', () => {
    expect(runMarkers({})).toEqual({})
  })

  it('treats an explicit false as absence, never as a marker value', () => {
    // `--no-gate-run`-shaped input, or a programmatic caller spreading a defaulted options object.
    // The result must be an ABSENT field: `{ gateRun: false }` would serialize into the handoff and
    // the analyze-run payload as a value neither schema admits.
    const markers = runMarkers({ gateRun: false, excludedFromOutcomes: false })
    expect(markers).toEqual({})
    expect(Object.hasOwn(markers, 'gateRun')).toBe(false)
    expect(Object.hasOwn(markers, 'excludedFromOutcomes')).toBe(false)
  })
})
