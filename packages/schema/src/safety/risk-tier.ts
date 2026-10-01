// 2026-10-01 (432-19, D-15/D-16): the risk tier is the classifier's output and eval's side-effect
// axis. The execution-policy verdict and result that rode beside it left with the gate.
export type RiskTier =
  | 'read-only'
  | 'mutating-local'
  | 'mutating-shared'
  | 'destructive'
  | 'restricted'
