import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { CEClient } from '../lib/ce-client.js'

/** Start a minimal mock CE bridge server on an ephemeral port. */
function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0)
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 4) {
          const len = buf.readUInt32LE(0)
          if (buf.length < 4 + len) break
          const body = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'))
          buf = buf.subarray(4 + len)

          let payload
          try {
            const result = handler(body)
            payload = JSON.stringify({ jsonrpc: '2.0', result, id: body.id })
          } catch (err) {
            payload = JSON.stringify({ jsonrpc: '2.0', error: { message: String((err && err.message) || err) }, id: body.id })
          }
          const out = Buffer.from(payload, 'utf8')
          const header = Buffer.alloc(4)
          header.writeUInt32LE(out.length)
          sock.write(header)
          sock.write(out)
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

test('CEClient sends length-prefixed JSON-RPC and parses success response', async () => {
  const { server, port } = await startMockServer((body) => ({ success: true, method: body.method, echo: body.params }))
  try {
    const client = new CEClient({ host: '127.0.0.1', port, timeoutMs: 5000 })
    const res = await client.sendCommand('ping', {})
    assert.equal(res.success, true)
    assert.equal(res.method, 'ping')
    client.close()
  } finally {
    server.close()
  }
})

test('CEClient maps JSON-RPC error to a structured result', async () => {
  const { server, port } = await startMockServer(() => { throw new Error('bridge exploded') })
  try {
    const client = new CEClient({ host: '127.0.0.1', port, timeoutMs: 5000 })
    const res = await client.sendCommand('ping', {})
    assert.equal(res.success, false)
    assert.match(res.error, /bridge exploded/)
    client.close()
  } finally {
    server.close()
  }
})

test('CEClient reconnects after a closed socket', async () => {
  let accepted = 0
  const { server, port } = await startMockServer((body) => {
    accepted += 1
    return { success: true, attempt: accepted }
  })
  try {
    const client = new CEClient({ host: '127.0.0.1', port, timeoutMs: 5000 })
    const first = await client.sendCommand('ping', {})
    assert.equal(first.attempt, 1)
    client.close()
    const second = await client.sendCommand('ping', {})
    assert.equal(second.attempt, 2)
    client.close()
  } finally {
    server.close()
  }
})
