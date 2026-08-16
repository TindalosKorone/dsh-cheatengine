import type { CEClient } from '../ce-client.js';
import type { ToolDef } from './types.js';
export type { ToolDef } from './types.js';
/**
 * Build all tool definitions.
 *
 * The segment order intentionally mirrors the original monolithic array order
 * in src/index.ts so registration and catalog ordering are unchanged.
 */
export declare function createToolDefs(client: CEClient): ToolDef[];
