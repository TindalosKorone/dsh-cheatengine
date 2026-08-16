import type { Context } from 'cordis';
import z from 'schemastery';
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
