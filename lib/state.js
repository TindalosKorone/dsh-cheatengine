import { createSessionState } from './session.js';
export let session = createSessionState();
export let snapshot = null;
export const sessions = new Map();
export const MAX_SESSIONS = 50;
export function pruneSessions(max = MAX_SESSIONS) {
    while (sessions.size > max) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined)
            break;
        sessions.delete(oldest);
    }
}
export function getSession(exec) {
    const id = exec?.agent?.session?.id || 'default';
    let s = sessions.get(id);
    if (!s) {
        s = createSessionState();
        sessions.set(id, s);
        pruneSessions();
    }
    else {
        sessions.delete(id);
        sessions.set(id, s);
    }
    return s;
}
export function setSession(s) {
    session = s;
}
export function setSnapshot(s) {
    snapshot = s;
}
//# sourceMappingURL=state.js.map
