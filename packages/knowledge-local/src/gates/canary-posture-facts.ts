// 2026-09-07, 418 D-13/D-14: bundle-local DATA only; no eligibility decisions.
import {
  asRecordId, isPromotionReceipt, standingReceiptsByGate, strongestPromotionPath,
  survivingOutcomeEvents, type GateReceipt, type ScopeKey,
} from '@vostride/agent-qa-schema'
import { deriveBundleTrust, readGateReceipts } from '../bundle-read.js'
import { enumerateMaintenanceBundleDirs, loadMaintenanceBundle } from '../maintenance-scan.js'

export type CanaryPostureFacts = {
  kind: 'found'
  gate1PassOrdinal?: number
  gate1PassDigest?: string
  /** Existing active authority cites this Gate-1 receipt; not admission eligibility. */
  lowerTrustActiveGate1Digest?: string
  latestAttributionOrdinal?: number
  latestGate2Ordinal?: number
  activeInScope: number
  lowerTrustActiveInScope: number
} | { kind: 'not-found' }

export interface StandingReceiptDigest {
  candidateId: string
  gate: GateReceipt['gate']
  verdict: GateReceipt['verdict']
  /** Gate 3 is user evidence and has no corpus citation. */
  corpusDigest?: string
  producedAtOrdinal: number
}

export interface LowerTrustShare { product: string; active: number; lowerTrust: number }

function readBundles(knowledgeRoot: string) {
  // Unlike the tolerant catalog listing, this strict walk cannot undercount a cap
  // or publish a clean share when a bundle's committed evidence is unreadable.
  return enumerateMaintenanceBundleDirs(knowledgeRoot).map(entry => {
    const bundle = loadMaintenanceBundle(entry)
    const lines = readGateReceipts(entry.dir, bundle.manifest.id) ?? []
    return { ...entry, bundle, lines, active: deriveBundleTrust(bundle).status === 'active' }
  })
}

function latest(ordinals: number[]): number | undefined {
  return ordinals.length === 0 ? undefined : Math.max(...ordinals)
}

export function canaryPostureFactsFor(input: {
  knowledgeRoot: string; candidateId: string; scope: ScopeKey
}): CanaryPostureFacts {
  const id = asRecordId(input.candidateId)
  const rows = readBundles(input.knowledgeRoot)
  const candidate = rows.find(row => row.bundle.manifest.id === id)
  if (candidate === undefined) return { kind: 'not-found' }
  const scope = candidate.bundle.frontmatter.scope
  // The rare-path cap is defined only for the candidate's product-tier scope.
  if (scope.tier !== 'product' || input.scope.tier !== 'product'
    || scope.key !== input.scope.key) return { kind: 'not-found' }
  const receipts = candidate.lines.filter((line): line is GateReceipt => !isPromotionReceipt(line))
  const pass = standingReceiptsByGate(receipts).find(row => row.gate === 1 && row.verdict === 'pass')
  const lowerTrustActiveGate1Digest = candidate.active
    && strongestPromotionPath(candidate.lines) === 'gate1-lower-trust'
    && survivingOutcomeEvents(candidate.bundle.events).some(event => event.type === 'promoted')
    && pass !== undefined
    && candidate.lines.some(line => isPromotionReceipt(line)
      && line.promotionPath === 'gate1-lower-trust'
      && line.citedReceiptDigests.includes(pass.receiptDigest))
    ? pass.receiptDigest : undefined
  const latestAttributionOrdinal = latest(survivingOutcomeEvents(candidate.bundle.events)
    .filter(event => ['confirmed', 'contradicted', 'helpful', 'harmful'].includes(event.type))
    .map(event => event.buildOrdinal))
  const latestGate2Ordinal = latest(receipts.filter(row => row.gate === 2).map(row => row.producedAtOrdinal))
  const active = rows.filter(row => row.active && row.product === candidate.product
    && row.bundle.frontmatter.scope.tier === 'product' && row.bundle.frontmatter.scope.key === scope.key)
  return {
    kind: 'found',
    ...(pass === undefined ? {} : { gate1PassOrdinal: pass.producedAtOrdinal, gate1PassDigest: pass.receiptDigest }),
    ...(lowerTrustActiveGate1Digest === undefined ? {} : { lowerTrustActiveGate1Digest }),
    ...(latestAttributionOrdinal === undefined ? {} : { latestAttributionOrdinal }),
    ...(latestGate2Ordinal === undefined ? {} : { latestGate2Ordinal }),
    activeInScope: active.length,
    lowerTrustActiveInScope: active.filter(row => strongestPromotionPath(row.lines) === 'gate1-lower-trust').length,
  }
}

export function standingReceiptDigestsFor(input: { knowledgeRoot: string }): StandingReceiptDigest[] {
  return readBundles(input.knowledgeRoot).flatMap(row => standingReceiptsByGate(
    row.lines.filter((line): line is GateReceipt => !isPromotionReceipt(line)),
  ).map(receipt => ({
    candidateId: receipt.candidateId, gate: receipt.gate, verdict: receipt.verdict,
    ...('corpusVersion' in receipt ? { corpusDigest: receipt.corpusVersion.corpusDigest } : {}),
    producedAtOrdinal: receipt.producedAtOrdinal,
  })))
}

export function lowerTrustSharesFor(input: { knowledgeRoot: string }): LowerTrustShare[] {
  const products = new Map<string, LowerTrustShare>()
  for (const row of readBundles(input.knowledgeRoot)) {
    const share = products.get(row.product) ?? { product: row.product, active: 0, lowerTrust: 0 }
    products.set(row.product, share)
    if (!row.active) continue
    share.active += 1
    if (strongestPromotionPath(row.lines) === 'gate1-lower-trust') share.lowerTrust += 1
  }
  return [...products.values()]
}
