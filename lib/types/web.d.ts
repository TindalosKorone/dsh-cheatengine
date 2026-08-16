/**
 * Web status page + legacy inline panel script for dsh-cheatengine.
 */
import type { SessionState } from './session.js';
export declare function buildStats(s: SessionState): any;
export declare function renderStatusHtml(s: SessionState): string;
export declare function panelScript(): string;
export declare function injectStatusPanel(html: string): string;
