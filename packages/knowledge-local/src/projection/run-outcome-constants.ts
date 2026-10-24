/**
 * PROVISIONAL last-N window for per-test outcome history (~10 pending ABRF-02 ranking
 * measurements). Entries are {buildOrdinal, passed} — ordinals only, wall-clock never.
 * Shared by readers and writers without pulling writer authority into the read closure.
 */
export const LAST_OUTCOMES_LIMIT = 10
