export interface CEClientOptions {
    host?: string;
    port?: number;
    timeoutMs?: number;
}
export declare class CEClient {
    private host;
    private port;
    private timeoutMs;
    private socket;
    private buffer;
    private pending;
    private nextId;
    private connecting;
    constructor(options?: CEClientOptions);
    get endpoint(): {
        host: string;
        port: number;
    };
    get connected(): boolean;
    /** Update endpoint and drop any existing connection. */
    configure(host: string, port: number): void;
    connect(): Promise<void>;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<any>;
    close(): void;
    private onData;
    private failPending;
}
