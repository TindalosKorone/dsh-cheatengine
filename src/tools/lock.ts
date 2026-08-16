import { pushUndo } from '../session.js'
import { session } from '../state.js'
import type { ToolDef } from './types.js'

export const lockDefs: ToolDef[] = [
  {
    name: 'ce_lock_address',
    description: '锁定/冻结指定地址：周期性写回目标值，适合做无限资源',
    method: 'ce_lock_address',
    dangerous: true,
    parameters: {
      address: { type: 'string', required: true, description: '要锁定的地址' },
      value: { type: 'number', required: true, description: '要锁定的值' },
      type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
      interval_ms: { type: 'integer', description: '写回间隔毫秒，默认 100' },
    },
    async execute(args: any, client: any) {
      const address = String(args.address || '').trim()
      const value = Number(args.value)
      if (!address || !Number.isFinite(value)) return { success: false, error: 'address and value are required' }
      const type = args.type || 'dword'
      const interval = Number(args.interval_ms) || 100
      const addrNum = Number.parseInt(address.replace(/^0x/i, ''), 16)
      if (!Number.isFinite(addrNum)) return { success: false, error: 'invalid address' }
      const writers: Record<string, string> = {
        byte: `writeBytes(addr, {value})`,
        word: `writeSmallInteger(addr, value)`,
        dword: `writeInteger(addr, value)`,
        qword: `writeQword(addr, value)`,
        float: `writeFloat(addr, value)`,
        double: `writeDouble(addr, value)`,
      }
      const writer = writers[type]
      if (!writer) return { success: false, error: `unsupported type: ${type}` }
      const lua = [
        `local addr = ${addrNum}`,
        `local value = ${value}`,
        `_G.__mcp_locks = _G.__mcp_locks or {}`,
        `if _G.__mcp_locks[addr] then _G.__mcp_locks[addr].destroy() end`,
        `local timer = createTimer(nil, false)`,
        `timer.Interval = ${interval}`,
        `timer.OnTimer = function()`,
        `  ${writer}`,
        `end`,
        `timer.Enabled = true`,
        `_G.__mcp_locks[addr] = timer`,
        `return "locked"`,
      ].join('\n')
      const res = await client.sendCommand('evaluate_lua', { code: lua })
      if (!res || res.success === false) {
        return { success: false, error: (res && res.error) || 'lock failed', error_class: 'BRIDGE_UNAVAILABLE' }
      }
      if (String(res.result || '').trim() !== 'locked') {
        return { success: false, error: `lock failed: ${String(res.result || res.error || 'unknown')}`, error_class: 'LOCK_FAILED' }
      }
      pushUndo(session, { kind: 'lock', address, value, type, ts: Date.now() })
      return { success: true, address, value, type, interval_ms: interval, lua_result: res }
    },
  },
  {
    name: 'ce_unlock_address',
    description: '停止锁定指定地址',
    method: 'ce_unlock_address',
    dangerous: true,
    parameters: {
      address: { type: 'string', required: true, description: '要解锁的地址' },
    },
    async execute(args: any, client: any) {
      const address = String(args.address || '').trim()
      const addrNum = Number.parseInt(address.replace(/^0x/i, ''), 16)
      if (!Number.isFinite(addrNum)) return { success: false, error: 'invalid address' }
      const lua = [
        `local addr = ${addrNum}`,
        `if _G.__mcp_locks and _G.__mcp_locks[addr] then`,
        `  _G.__mcp_locks[addr].destroy()`,
        `  _G.__mcp_locks[addr] = nil`,
        `  return "unlocked"`,
        `else`,
        `  return "not locked"`,
        `end`,
      ].join('\n')
      const res = await client.sendCommand('evaluate_lua', { code: lua })
      if (!res || res.success === false) {
        return { success: false, error: (res && res.error) || 'unlock failed', error_class: 'BRIDGE_UNAVAILABLE' }
      }
      return { success: true, address, lua_result: res }
    },
  },
]
