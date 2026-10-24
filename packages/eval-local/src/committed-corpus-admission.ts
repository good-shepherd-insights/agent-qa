import type { CommittedCorpusRead, CommittedReadRefusal } from './committed-corpus-source.js'
import type { loadCassetteBundles } from './replay-sweep.js'

/** Admission of the complete committed input precedes replay and any scored-key pairing. */
export function committedCorpusAdmissionRefusal(
  committedRoot: string,
  corpus: CommittedCorpusRead,
  loaded: ReturnType<typeof loadCassetteBundles>,
): CommittedReadRefusal | undefined {
  const refuse = (reason: string, path = committedRoot): CommittedReadRefusal => ({
    path, reason: `committed corpus admission refused: ${reason}`,
  })
  if (corpus.refusals.length > 0) {
    const first = corpus.refusals[0]!
    return refuse(first.reason, first.path)
  }
  const loadFailures = Object.entries(loaded.loadRefusals).filter(([, count]) => count > 0)
  if (loadFailures.length > 0) {
    return refuse(`cassette bundle load refusals: ${loadFailures.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }
  const expected = new Set<string>()
  for (const entry of corpus.snapshot.entries) {
    if (expected.has(entry.cassetteId)) return refuse(`duplicate committed member ${entry.cassetteId}`)
    expected.add(entry.cassetteId)
  }
  if (expected.size === 0) return refuse('no guarded committed members')
  const seen = new Set<string>()
  for (const { cassette } of loaded.loaded) {
    if (corpus.retiredMarkedCassetteIds?.has(cassette.id)) continue
    if (!expected.has(cassette.id)) return refuse(`foreign cassette member ${cassette.id}`)
    if (seen.has(cassette.id)) return refuse(`duplicate cassette member ${cassette.id}`)
    seen.add(cassette.id)
  }
  const missing = [...expected].filter(id => !seen.has(id))
  if (missing.length > 0) return refuse(`missing cassette members: ${missing.join(', ')}`)
  // Blob availability is deliberately not admission: a complete guarded cassette may
  // yield the established missing-blob replay refusal and remain in the report population.
  return undefined
}
