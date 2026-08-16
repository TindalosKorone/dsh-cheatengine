import { createSessionState, type SessionState } from './session.js'

export let session: SessionState = createSessionState()
export let snapshot: any = null
export const sessions = new Map<string, SessionState>()

/** Max number of per-session states kept in memory (low-concurrency scope). */
export const MAX_SESSIONS = 50

/**
 * Drop the least-recently-used session states above the cap.
 * This plugin targets single-user / low-concurrency debugging; the cap is a
 * cheap safeguard so long-running DSH processes do not accumulate unbounded
 * per-session state.
 */
export function pruneSessions(max = MAX_SESSIONS): void {
  while (sessions.size > max) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
}

export function getSession(exec: any): SessionState {
  const id = exec?.agent?.session?.id || 'default'
  let s = sessions.get(id)
  if (!s) {
    s = createSessionState()
    sessions.set(id, s)
    pruneSessions()
  } else {
    // Refresh LRU order so pruneSessions drops the least recently used state.
    sessions.delete(id)
    sessions.set(id, s)
  }
  return s
}

export function setSession(s: SessionState): void {
  session = s
}

export function setSnapshot(s: any): void {
  snapshot = s
}
