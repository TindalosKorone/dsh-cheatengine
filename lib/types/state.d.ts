import { type SessionState } from './session.js';
export declare let session: SessionState;
export declare let snapshot: any;
export declare const sessions: Map<string, SessionState>;
export declare function getSession(exec: any): SessionState;
export declare function setSession(s: SessionState): void;
export declare function setSnapshot(s: any): void;
