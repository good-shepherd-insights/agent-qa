export interface RunIdentityMember {
  name: string
  testId: string
  filePath: string
  suiteId?: string
  suiteName?: string
}

export interface RunRowIdentity {
  name: string
  testId?: string
  filePath?: string
  suiteId?: string
}

const TITLE_SEPARATOR = ' · '

export function formatRunTitle(names: readonly string[]): string {
  if (names.length === 0) return 'run'
  const shown = names.slice(0, 2).join(TITLE_SEPARATOR)
  const rest = names.length - 2
  return rest >= 1 ? `${shown} +${String(rest)} more` : shown
}

export function runRowIdentity(members: readonly RunIdentityMember[]): RunRowIdentity {
  const first = members[0]
  if (first === undefined) return { name: 'run' }
  if (members.length === 1) {
    return {
      name: first.suiteId !== undefined && first.suiteName ? first.suiteName : first.name,
      testId: first.testId,
      filePath: first.filePath,
      ...(first.suiteId === undefined ? {} : { suiteId: first.suiteId }),
    }
  }
  if (first.suiteId !== undefined && members.every((member) => member.suiteId === first.suiteId)) {
    return { name: first.suiteName || first.suiteId, suiteId: first.suiteId }
  }
  const seenSuites = new Set<string>()
  const labels: string[] = []
  for (const member of members) {
    if (member.suiteId === undefined) {
      labels.push(member.name)
    } else if (!seenSuites.has(member.suiteId)) {
      seenSuites.add(member.suiteId)
      labels.push(member.suiteName || member.suiteId)
    }
  }
  return { name: formatRunTitle(labels) }
}
