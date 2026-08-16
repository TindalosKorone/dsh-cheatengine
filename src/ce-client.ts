/**
 * CE TCP bridge client.
 *
 * Talks to the Cheat Engine MCP Bridge (ce_mcp_bridge.lua + ce_mcp_tcp DLL)
 * using length-prefixed JSON-RPC 2.0 frames:
 *
 *   uint32 LE body length | UTF-8 JSON body
 *
 * Only one request is in flight at a time; the bridge is single-connection and
 * responses arrive in order.
 */
import { Socket } from 'node:net'

export interface CEClientOptions {
  host?: string
  port?: number
  timeoutMs?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

const MAX_RESPONSE_SIZE = 32 * 1024 * 1024

export class CEClient {
  private host: string
  private port: number
  private timeoutMs: number
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private pending: Pending[] = []
  private nextId = 1
  private connecting: Promise<void> | null = null

  constructor(options: CEClientOptions = {}) {
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 17171
    this.timeoutMs = options.timeoutMs ?? 90000
  }

  get endpoint(): { host: string; port: number } {
    return { host: this.host, port: this.port }
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  /** Update endpoint and drop any existing connection. */
  configure(host: string, port: number): void {
    this.host = host || this.host
    const p = Number(port)
    if (Number.isFinite(p) && p > 0) this.port = p
    this.close()
  }

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket
      this.buffer = Buffer.alloc(0)

      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        this.failPending(err)
        reject(err)
      }

      socket.setNoDelay(true)
      socket.setKeepAlive(true)
      socket.on('data', (chunk: Buffer) => this.onData(chunk))
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null
        this.failPending(new Error('CE bridge connection closed'))
      })
      socket.on('error', (err: Error) => {
        if (this.socket === socket) this.socket = null
        fail(err)
      })
      socket.on('connect', () => {
        if (settled) return
        settled = true
        resolve()
      })
      socket.connect(this.port, this.host)
    })

    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.connect()

    const request = {
      jsonrpc: '2.0',
      method,
      params: params || {},
      id: this.nextId++,
    }
    const body = Buffer.from(JSON.stringify(request), 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length)

    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close()
        reject(new Error(`CE command '${method}' timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()

      this.pending.push({ resolve, reject, timer })
      if (!this.socket) {
        clearTimeout(timer)
        this.pending.pop()
        reject(new Error('CE bridge socket is not connected'))
        return
      }
      this.socket.write(header)
      this.socket.write(body)
    })
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.failPending(new Error('CE bridge connection closed'))
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0)
      if (len > MAX_RESPONSE_SIZE) {
        this.close()
        this.failPending(new Error(`CE bridge response too large: ${len} bytes`))
        return
      }
      if (this.buffer.length < 4 + len) break

      const body = this.buffer.subarray(4, 4 + len).toString('utf8')
      this.buffer = this.buffer.subarray(4 + len)

      let msg: any
      try {
        msg = JSON.parse(body)
      } catch {
        continue
      }

      const pending = this.pending.shift()
      if (!pending) continue
      clearTimeout(pending.timer)
      if (msg && msg.error) {
        pending.resolve({ success: false, error: JSON.stringify(msg.error) })
      } else {
        pending.resolve(msg && msg.result !== undefined ? msg.result : msg)
      }
    }
  }

  private failPending(err: Error): void {
    const list = this.pending.splice(0)
    for (const p of list) {
      clearTimeout(p.timer)
      p.reject(err)
    }
  }
}
