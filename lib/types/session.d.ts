/**
 * Session state for dsh-cheatengine.
 *
 * Centralizes the per-debug-session state machine, capacity caps, and the L0
 * automatic one-line summary + capped recent events.
 */
export interface SessionState {
    phase: string;
    startTime: number;
    calls: any[];
    scanCount: number;
    cache: Map<string, any>;
    locks: Set<string>;
    audit: any[];
    hypotheses: any[];
    undoStack: any[];
    summary: string;
    evidence: any[];
    recentEvents: any[];
}
export declare function createSessionState(): SessionState;
/** Capacity caps for unbounded session collections. */
export declare const MAX_UNDO = 100;
export declare const MAX_EVIDENCE = 200;
export declare const MAX_HYPOTHESES = 100;
export declare const MAX_AUDIT = 200;
export declare const MAX_RECENT_EVENTS = 5;
export declare const MAX_CALLS = 200;
export declare function pushCapped<T>(arr: T[], item: T, cap: number): void;
export declare function pushUndo(s: SessionState, item: any): void;
export declare function pushEvidence(s: SessionState, item: any): void;
export declare function pushHypothesis(s: SessionState, item: any): void;
export declare function pushAudit(s: SessionState, item: any): void;
export declare function pushRecentEvent(s: SessionState, text: string): void;
export declare function updateSession(s: SessionState, toolName: string, args: any, result: any): void;
