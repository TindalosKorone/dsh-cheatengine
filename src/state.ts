import { createSessionState, type SessionState } from './session.js'

export let session: SessionState = createSessionState()
export let snapshot: any = null
export const sessions = new Map<string, SessionState>()

export function getSession(exec: any): SessionState {
  const id = exec?.agent?.session?.id || 'default'
  let s = sessions.get(id)
  if (!s) {
    s = createSessionState()
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
