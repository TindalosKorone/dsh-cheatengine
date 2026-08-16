/**
 * CE TCP bridge client (JS runtime build).
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

const MAX_RESPONSE_SIZE = 32 * 1024 * 1024

export class CEClient {
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 17171
    this.timeoutMs = options.timeoutMs ?? 90000
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.pending = []
    this.nextId = 1
    this.connecting = null
  }

  get endpoint() {
    return { host: this.host, port: this.port }
  }

  get connected() {
    return this.socket !== null && !this.socket.destroyed
  }

  configure(host, port) {
    if (host) this.host = host
    const p = Number(port)
    if (Number.isFinite(p) && p > 0) this.port = p
    this.close()
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket
      this.buffer = Buffer.alloc(0)

      let settled = false
      const fail = (err) => {
        if (settled) return
        settled = true
        this.failPending(err)
        reject(err)
      }

      socket.setNoDelay(true)
      socket.setKeepAlive(true)
      socket.on('data', (chunk) => this.onData(chunk))
      socket.on('close', () => {
        this.socket = null
        this.failPending(new Error('CE bridge connection closed'))
      })
      socket.on('error', (err) => {
        this.socket = null
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

  async sendCommand(method, params = {}) {
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

    return new Promise((resolve, reject) => {
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

  close() {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.failPending(new Error('CE bridge connection closed'))
  }

  onData(chunk) {
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

      let msg
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

  failPending(err) {
    const list = this.pending.splice(0)
    for (const p of list) {
      clearTimeout(p.timer)
      p.reject(err)
    }
  }
}
