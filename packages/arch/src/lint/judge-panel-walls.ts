import type { CalibrationSource } from './label-calibration-walls.js'

export interface JudgePanelDiagnostic { file: string; rule: string; line: number }

export function judgePanelWalls(_sources: readonly CalibrationSource[]): JudgePanelDiagnostic[] {
  return []
}
