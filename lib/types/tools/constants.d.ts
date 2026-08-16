/** Always-visible tools: connection status + on-demand discovery + guide. */
export declare const RESIDENT_TOOLS: Set<string>;
export declare const isOwnTool: (name: string) => boolean;
/** Tools that have been merged into unified equivalents; kept for compat but hidden from packs/search. */
export declare const COMPAT_TOOLS: Set<string>;
/** Task packs: unlock a coherent group of tools with one ce_tool_search call. */
export declare const TOOL_PACKS: Record<string, string[]>;
