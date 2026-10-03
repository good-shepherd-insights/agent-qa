// The chat verbs 432 retired, answered by name (quick 261003-cpv, 432 review IN-05).
//
// 432-13 removed `/pin` (a session deny overlay over an op gate that no longer exists) and the
// bare `proposals` inbox alias (there is no inbox). Neither is a directive or an alias any more:
// the resolver table does not resolve them, and its deletion census keeps it that way. But a clause
// stage 1 leaves unresolved flows to the planner, and in a live session a model may plan the op the
// text of `/pin fn:runs.start` names, which is the opposite of what a person with the old habit
// meant. So the turn engine asks this module before stage 2 and refuses such a turn by name.
//
// EXACT SPELLINGS ONLY: the `/pin` verb with or without an argument, in any case, and the bare word
// `proposals`. A near-miss such as `/pinned` is not a retired verb and still flows on, as D-09 has
// every near-miss do.

const RETIRED_PIN = '/pin'
const RETIRED_INBOX = 'proposals'

function isRetiredPin(lowered: string): boolean {
  if (lowered === RETIRED_PIN) return true
  if (!lowered.startsWith(RETIRED_PIN)) return false
  const next = lowered.charAt(RETIRED_PIN.length)
  return next === ' ' || next === '\t'
}

/** The refusal a retired chat verb gets, or `undefined` for any other clause. */
export function retiredChatVerbReason(clause: string): string | undefined {
  const lowered = clause.trim().toLowerCase()
  if (isRetiredPin(lowered)) {
    return '/pin was retired in this version: nothing asks before an operation runs, so there is '
      + 'nothing to pin. Nothing in this request was run.'
  }
  if (lowered === RETIRED_INBOX) {
    return 'the proposals inbox was retired in this version: changes apply when they are made, so '
      + 'nothing waits for a decision. Nothing in this request was run.'
  }
  return undefined
}
