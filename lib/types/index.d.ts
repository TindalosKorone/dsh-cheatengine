import type { Context } from 'cordis';
import z from 'schemastery';
import { CEClient } from './ce-client.js';
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
interface ToolDef {
    name: string;
    description: string;
    parameters?: Record<string, any>;
    method: string;
    mapParams?: (args: any) => Record<string, any>;
    mapResult?: (result: any, args: any) => any;
    execute?: (args: any, client: CEClient) => Promise<any>;
    dangerous?: boolean;
    kind?: 'search';
}
/** Tool definitions. `dangerous` tools are hidden until explicitly unlocked. */
export declare function createToolDefs(client: CEClient): ToolDef[];
export declare function apply(ctx: Context, config: Config): void;
export {};
