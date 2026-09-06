// 2026-09-06, 416 D-17/D-18: READS ONLY. This answer derives from committed
// receipt history and the pure gate. ABSENCE IS A ROW; unreadable data still throws.
import { asRecordId, evaluatePromotionGate, isPromotionReceipt, KnowledgeGatesListResultSchema,
  standingReceiptsByGate, strongestPromotionPath,
  type GateReceipt, type KnowledgeGatesListResult, type ResolvePromotionPosture } from '@vostride/agent-qa-schema'
import { deriveBundleTrust, readGateReceipts } from '../bundle-read.js'
import { enumerateMaintenanceBundleDirs, loadMaintenanceBundle } from '../maintenance-scan.js'
import { assemblePromotionGateInput } from '../promotion-gate-input.js'

export interface GateReceiptsForOptions {
  knowledgeRoot: string
  candidateId: string
  /** Resolved per candidate by the same assembly used by the promotion doors. */
  resolvePromotionPosture?: ResolvePromotionPosture
}
export function gateReceiptsFor(options: GateReceiptsForOptions): KnowledgeGatesListResult {
  const id = asRecordId(options.candidateId)
  for (const entry of enumerateMaintenanceBundleDirs(options.knowledgeRoot)) {
    const bundle = loadMaintenanceBundle(entry)
    if (bundle.manifest.id !== id) continue
    const lines = readGateReceipts(entry.dir, id) ?? []
    const standing = standingReceiptsByGate(
      lines.filter((line): line is GateReceipt => !isPromotionReceipt(line)),
    )
    const path = strongestPromotionPath(lines)
    const gateInput = assemblePromotionGateInput({
      knowledgeRoot: options.knowledgeRoot, bundleDir: entry.dir, bundle,
      resolvePromotionPosture: options.resolvePromotionPosture,
    })
    return KnowledgeGatesListResultSchema.parse({
      kind: 'found', recordId: id, product: entry.product,
      recordKind: bundle.frontmatter.kind, status: deriveBundleTrust(bundle).status,
      ...(path === undefined ? {} : { strongestPromotionPath: path }),
      lines, standing,
      // 416-DOOR: read live-verdict
      live: evaluatePromotionGate(gateInput),
      // 'resolved' and 'unavailable' describe the actual posture the gate judged.
      posture: gateInput.gatePosture?.kind ?? 'absent',
    })
  }
  return { kind: 'not-found', recordId: options.candidateId }
}
