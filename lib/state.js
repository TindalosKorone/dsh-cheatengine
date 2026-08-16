import { createSessionState } from './session.js';
export let session = createSessionState();
export let snapshot = null;
export const sessions = new Map();
export function getSession(exec) {
    const id = exec?.agent?.session?.id || 'default';
    let s = sessions.get(id);
    if (!s) {
        s = createSessionState();
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