/**
 * @dsh-external/dsh-cheatengine — Cheat Engine bridge toolkit.
 *
 * Exposes ce_* tools to the DSH agent. The plugin is a thin JSON-RPC client
 * for the Cheat Engine MCP Bridge (ce_mcp_bridge.lua + ce_mcp_tcp DLL):
 *   https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge
 *
 * Tool exposure policy (progressive disclosure, mirrors DSH anchored-standard):
 *   - Only ce_status / ce_connect / ce_tool_search are always visible.
 *   - All other ce_* tools are registered but hidden from the model catalog
 *     until the agent unlocks them via ce_tool_search({"toolNames": [...]}).
 *   - Unlocked names are derived from durable tool/call events, so the
 *     unlocked set survives resume/reload within the session.
 *
 * Deployment (one-time, on the Windows machine running Cheat Engine):
 *   1. Copy ce_mcp_tcp_x64.dll (or x86) into the Cheat Engine directory.
 *   2. Open Cheat Engine, attach to the target process.
 *   3. File → Execute Script → run MCP_Server/ce_mcp_bridge.lua.
 *   4. Bridge listens on TCP 127.0.0.1:17171 by default.
 */
import type { Context } from 'cordis';
import z from 'schemastery';
export { createToolDefs } from './tools/index.js';
export declare const name = "@dsh-external/dsh-cheatengine";
export declare const inject: string[];
export interface Config {
    host: string;
    port: number;
    timeoutMs: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    host: z<string, string>;
    port: z<number, number>;
    timeoutMs: z<number, number>;
}>, Schemastery.ObjectT<{
    host: z<string, string>;
    port: z<number, number>;
    timeoutMs: z<number, number>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
