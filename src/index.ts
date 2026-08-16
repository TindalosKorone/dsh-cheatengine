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
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'
import z from 'schemastery'
import { CEClient } from './ce-client.js'

export const name = '@dsh-external/dsh-cheatengine'
export const inject = ['tools', 'skills', 'webServer']

export interface Config {
  host: string
  port: number
  timeoutMs: number
}

export const Config = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(17171),
  timeoutMs: z.number().default(90000),
})

const DEFAULTS: Config = {
  host: '127.0.0.1',
  port: 17171,
  timeoutMs: 90000,
}

function classifyError(error: any): string {
  const text = String((error && error.message) || error || "").toLowerCase()
  if (text.includes("no process attached") || text.includes("open_process") || text.includes("not attached")) return "NO_PROCESS"
  if (text.includes("econnrefused") || text.includes("timed out") || text.includes("bridge")) return "BRIDGE_UNAVAILABLE"
  if (text.includes("no scan results") || text.includes("no previous scan")) return "NO_SCAN"
  if (text.includes("invalid address") || text.includes("address")) return "INVALID_ADDRESS"
  if (text.includes("breakpoint") || text.includes("debug register")) return "BREAKPOINT_ERROR"
  if (text.includes("permission") || text.includes("denied") || text.includes("not writable")) return "PERMISSION_DENIED"
  if (text.includes("timeout")) return "TIMEOUT"
  if (text.includes("to undo") || text.includes("cannot undo")) return "UNDO_NOT_SUPPORTED"
  if (text.includes("no snapshot")) return "NO_SNAPSHOT"
  if (text.includes("invalid args") || text.includes("required")) return "INVALID_ARGS"
  return "UNKNOWN"
}

function withErrorClass(result: any, error?: any): any {
  if (result && result.success === false) {
    return { ...result, error_class: classifyError(result.error) }
  }
  if (result === undefined || result === null) {
    return { success: false, error: String((error && error.message) || error || "unknown"), error_class: classifyError(error) }
  }
  return result
}

const session = {
  phase: 'idle',
  startTime: Date.now(),
  calls: [] as any[],
  scanCount: 0,
  cache: new Map<string, any>(),
  locks: new Set<string>(),
  audit: [] as any[],
  hypotheses: [] as any[],
  undoStack: [] as any[],
  summary: '',
  evidence: [] as any[],
}

let snapshot: any = null

function updateSession(toolName: string, args: any, result: any): void {
  session.calls.push({
    tool: toolName,
    ts: Date.now(),
    ok: !(result && result.success === false),
    error_class: result && result.error_class,
  })
  if (session.calls.length > 200) session.calls.shift()

  if (toolName === 'ce_scan' && result && result.success !== false) {
    session.phase = 'scanning'
    session.scanCount = Number(result.count) || 0
    session.cache.set(String(args.value), { type: args.type || 'dword', count: session.scanCount, ts: Date.now() })
  } else if (toolName === 'ce_next_scan' && result && result.success !== false) {
    session.phase = 'filtering'
    session.scanCount = Number(result.count) || 0
  } else if (toolName === 'ce_find_what_writes' && result && result.success !== false) {
    session.phase = 'tracing'
  } else if (toolName === 'ce_pointer_scan' && result && result.success !== false) {
    session.phase = 'verifying'
  } else if (toolName === 'ce_lock_address' && result && result.success !== false) {
    session.phase = 'locked'
    session.locks.add(String(args.address))
  } else if (toolName === 'ce_unlock_address' && result && result.success !== false) {
    session.locks.delete(String(args.address))
  }
}
/** Always-visible tools: connection status + on-demand discovery. */
const RESIDENT_TOOLS = new Set(['ce_status', 'ce_connect', 'ce_tool_search'])

interface ToolDef {
  name: string
  description: string
  parameters?: Record<string, any>
  method: string
  mapParams?: (args: any) => Record<string, any>
  mapResult?: (result: any, args: any) => any
  execute?: (args: any, client: CEClient) => Promise<any>
  dangerous?: boolean
  kind?: 'search'
}

/** Tool definitions. `dangerous` tools are hidden until explicitly unlocked. */
export function createToolDefs(client: CEClient): ToolDef[] {
  return [
    // ── 连接 / 状态 ────────────────────────────────────────────────
    {
      name: 'ce_status',
      description: '检查与 Cheat Engine 桥接的连接，返回版本与当前附加进程信息',
      method: 'ping',
    },
    {
      name: 'ce_connect',
      description: '连接/重连 Cheat Engine 桥接，可指定 host/port，返回 ping 结果',
      method: 'ping',
      parameters: {
        host: { type: 'string', description: 'CE 桥接主机，默认 127.0.0.1' },
        port: { type: 'integer', description: 'CE 桥接端口，默认 17171' },
      },
      mapParams: (args) => {
        if (args.host || args.port) {
          client.configure(String(args.host || '127.0.0.1'), Number(args.port || 17171))
        }
        return {}
      },
    },

    // ── 进程 / 附加 ────────────────────────────────────────────────
    {
      name: 'ce_list_processes',
      description: '列出系统进程（PID+名称），供附加选择',
      method: 'get_process_list',
    },
    {
      name: 'ce_attach',
      description: '附加到指定进程（进程名或 PID），后续读写/扫描作用于该进程',
      method: 'open_process',
      parameters: {
        process_id_or_name: {
          type: 'string',
          required: true,
          description: '进程名（如 game.exe）或十进制 PID',
        },
      },
    },
    {
      name: 'ce_process_info',
      description: '获取当前已附加进程的 PID、名称、模块数与架构',
      method: 'get_process_info',
    },
    {
      name: 'ce_enum_modules',
      description: '列出已附加进程加载的模块（DLL/EXE 基址和大小）',
      method: 'enum_modules',
      parameters: {
        offset: { type: 'integer', description: '分页偏移，默认 0' },
        limit: { type: 'integer', description: '返回数量，默认 100' },
      },
    },

    // ── 扫描 / 搜索 ────────────────────────────────────────────────
    {
      name: 'ce_scan',
      description: '首次扫描内存：只返回匹配数量 count，具体地址用 ce_get_scan_results 分页读取',
      method: 'scan_all',
      parameters: {
        value: { type: 'string', required: true, description: '要搜索的值，如 "100"、"hello" 或 "48 89 5C"' },
        type: { type: 'string', description: 'byte|word|dword|qword|float|double|string，默认 dword（兼容旧值 exact→dword）' },
        protection: { type: 'string', description: '内存保护，默认 +W-C' },
      },
      mapParams: (args) => {
        const type = args.type || 'dword'
        const normalized = type === 'exact' ? 'dword' : type
        return { ...args, type: normalized }
      },
    },
    {
      name: 'ce_next_scan',
      description: '在现有结果上继续扫描过滤（increased/decreased/changed/unchanged 等）',
      method: 'next_scan',
      parameters: {
        value: { type: 'string', required: true, description: '下一轮值' },
        scan_type: { type: 'string', description: 'exact|increased|decreased|changed|unchanged|bigger|smaller，默认 exact' },
      },
    },
    {
      name: 'ce_get_scan_results',
      description: '读取最近一次扫描的地址结果，支持分页',
      method: 'get_scan_results',
      parameters: {
        offset: { type: 'integer', description: '偏移，默认 0' },
        limit: { type: 'integer', description: '数量，默认 100' },
      },
      mapParams: (args) => ({ ...args, limit: Math.min(Number(args.limit) || 100, 1000) }),
    },
    {
      name: 'ce_aob_scan',
      description: 'AOB 特征码扫描，如 "48 89 5C 24 ?? 57"',
      method: 'aob_scan',
      parameters: {
        pattern: { type: 'string', required: true, description: '字节模式，支持 ?? 通配' },
        protection: { type: 'string', description: '内存保护，默认 +X' },
        limit: { type: 'integer', description: '最大返回数，默认 100' },
      },
      mapParams: (args) => ({ ...args, limit: Math.min(Number(args.limit) || 100, 1000) }),
    },
    {
      name: 'ce_search_string',
      description: '在内存中搜索文本字符串',
      method: 'search_string',
      parameters: {
        string: { type: 'string', required: true, description: '要搜索的字符串' },
        wide: { type: 'boolean', description: '是否宽字符 UTF-16，默认 false' },
        limit: { type: 'integer', description: '最大返回数，默认 100' },
      },
    },

    // ── 内存读取 ───────────────────────────────────────────────────
    {
      name: 'ce_read_memory',
      description: '读取指定地址的原始字节',
      method: 'read_memory',
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址，如 0x00401000' },
        size: { type: 'integer', description: '读取字节数，默认 256' },
      },
      mapParams: (args) => ({ ...args, size: Math.min(Number(args.size) || 256, 4096) }),
    },
    {
      name: 'ce_read_integer',
      description: '读取数值：byte|word|dword|qword|float|double',
      method: 'read_integer',
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址' },
        type: { type: 'string', description: '类型，默认 dword' },
      },
    },
    {
      name: 'ce_read_string',
      description: '读取字符串，支持 ascii/utf8/utf16le/raw',
      method: 'read_string',
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址' },
        max_length: { type: 'integer', description: '最大长度，默认 256' },
        encoding: { type: 'string', description: 'ascii|utf8|utf16le|raw，默认 utf8' },
      },
    },
    {
      name: 'ce_read_pointer_chain',
      description: '按多级指针链读取最终地址与值',
      method: 'read_pointer_chain',
      parameters: {
        base: { type: 'string', required: true, description: '基址，如模块基址' },
        offsets: { type: 'array', items: { type: 'integer' }, description: '每级偏移，如 [0x10, 0x20]' },
      },
    },

    // ── 内存写入（危险） ───────────────────────────────────────────
    {
      name: 'ce_write_integer',
      description: '写入数值到指定地址',
      method: 'write_integer',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址' },
        value: { type: 'integer', required: true, description: '要写入的数值' },
        type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        const type = args.type || 'dword'
        const beforeRes = await client.sendCommand('read_integer', { address, type })
        const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null
        const res = await client.sendCommand('write_integer', { address, value: Number(args.value), type })
        if (res && res.success !== false) {
          session.undoStack.push({ kind: 'write', address, type, before, after: Number(args.value), ts: Date.now() })
        }
        return res
      },
    },
    {
      name: 'ce_write_memory',
      description: '写入原始字节到指定地址',
      method: 'write_memory',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址' },
        bytes: { type: 'array', items: { type: 'integer' }, required: true, description: '字节数组，如 [0x90, 0x90]' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        const bytes = Array.isArray(args.bytes) ? args.bytes.map(Number) : []
        if (!address || bytes.length === 0) return { success: false, error: 'address and bytes are required', error_class: 'INVALID_ARGS' }
        const readRes = await client.sendCommand('read_memory', { address, size: bytes.length })
        const before = readRes && readRes.success !== false && Array.isArray(readRes.bytes) ? readRes.bytes : null
        const res = await client.sendCommand('write_memory', { address, bytes })
        if (res && res.success !== false) {
          session.undoStack.push({ kind: 'write_memory', address, before, after: bytes, ts: Date.now() })
        }
        return res
      },
    },
    {
      name: 'ce_write_string',
      description: '写入字符串到指定地址',
      method: 'write_string',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '十六进制地址' },
        value: { type: 'string', required: true, description: '要写入的字符串' },
        wide: { type: 'boolean', description: '是否宽字符 UTF-16，默认 false' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        const value = String(args.value ?? '')
        const wide = !!args.wide
        if (!address) return { success: false, error: 'address is required', error_class: 'INVALID_ARGS' }
        const maxLen = wide ? value.length * 2 : value.length
        const readRes = await client.sendCommand('read_string', { address, max_length: maxLen, encoding: wide ? 'utf16le' : 'utf8' })
        const before = readRes && readRes.success !== false ? readRes.value : null
        const res = await client.sendCommand('write_string', { address, value, wide })
        if (res && res.success !== false) {
          session.undoStack.push({ kind: 'write_string', address, before, after: value, wide, ts: Date.now() })
        }
        return res
      },
    },

    // ── 反汇编 / 分析 ─────────────────────────────────────────────
    {
      name: 'ce_disassemble',
      description: '从指定地址反汇编 N 条指令',
      method: 'disassemble',
      parameters: {
        address: { type: 'string', required: true, description: '起始地址或符号' },
        count: { type: 'integer', description: '生成指令数，默认 20' },
        limit: { type: 'integer', description: '返回条数，默认 100' },
      },
      mapParams: (args) => ({ ...args, count: Math.min(Number(args.count) || 20, 200), limit: Math.min(Number(args.limit) || 100, 200) }),
    },
    {
      name: 'ce_get_instruction_info',
      description: '获取单条指令的详细信息（大小、字节、助记符）',
      method: 'get_instruction_info',
      parameters: {
        address: { type: 'string', required: true, description: '指令地址' },
      },
    },

    // ── 断点 / 调试（危险） ───────────────────────────────────────
    {
      name: 'ce_set_breakpoint',
      description: '设置执行断点（硬件），捕获寄存器/栈，不中断仅记录',
      method: 'set_breakpoint',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '断点地址' },
        id: { type: 'string', description: '自定义断点 ID' },
        capture_registers: { type: 'boolean', description: '是否捕获寄存器，默认 true' },
        capture_stack: { type: 'boolean', description: '是否捕获调用栈，默认 false' },
      },
    },
    {
      name: 'ce_set_data_breakpoint',
      description: '设置数据断点（读/写/访问），监控某地址被访问',
      method: 'set_data_breakpoint',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '监控地址' },
        access_type: { type: 'string', description: 'r|w|rw，默认 w' },
        size: { type: 'integer', description: '监控字节数，默认 4' },
        id: { type: 'string', description: '自定义断点 ID' },
      },
    },
    {
      name: 'ce_list_breakpoints',
      description: '列出所有活动断点',
      method: 'list_breakpoints',
    },
    {
      name: 'ce_remove_breakpoint',
      description: '按 ID 移除断点',
      method: 'remove_breakpoint',
      dangerous: true,
      parameters: {
        id: { type: 'string', required: true, description: '断点 ID' },
      },
    },
    {
      name: 'ce_get_breakpoint_hits',
      description: '读取断点命中记录（含寄存器），可清空缓冲区',
      method: 'get_breakpoint_hits',
      parameters: {
        id: { type: 'string', description: '指定断点 ID，缺省全部' },
        clear: { type: 'boolean', description: '读取后是否清空，默认 false' },
        limit: { type: 'integer', description: '返回条数，默认 100' },
        offset: { type: 'integer', description: '跳过前 N 条，默认 0' },
        filter: { type: 'string', description: '寄存器过滤，如 RDI=1B5AD10F640（十六进制不带 0x）' },
      },
      mapParams: (args) => {
        if (args.filter) {
          return { ...args, offset: 0, limit: 10000 }
        }
        return args
      },
      mapResult: (result, args) => {
        if (!result || !Array.isArray(result.hits)) return result
        let hits = result.hits
        if (args.filter) {
          const m = /^([A-Za-z0-9_]+)=([0-9A-Fa-f]+)$/.exec(args.filter)
          if (m) {
            const reg = m[1].toUpperCase()
            const val = m[2].toUpperCase()
            hits = hits.filter((hit: any) => {
              const r = hit && hit.registers ? hit.registers[reg] : undefined
              return r && r.toUpperCase().replace(/^0X/, '') === val
            })
          }
          const offset = Number(args.offset) || 0
          const limit = Number(args.limit) || 100
          hits = hits.slice(offset, offset + limit)
          return { ...result, hits, offset, limit, returned: hits.length, total: hits.length }
        }
        return result
      },
    },
    {
      name: 'ce_clear_breakpoints',
      description: '清除全部断点',
      method: 'clear_all_breakpoints',
      dangerous: true,
    },
    {
      name: 'ce_get_registers',
      description: '获取当前线程寄存器（RAX/RBX/... 或 EAX/EBX/...），含 XMM0-XMM15',
      method: 'evaluate_lua',
      mapParams: () => ({
        code: [
          'local parts = {}',
          'local function h(v) if v == nil then return "nil" end return string.format("%X", v) end',
          'if targetIs64Bit() then',
          '  parts[#parts+1] = string.format("RAX=%s RBX=%s RCX=%s RDX=%s RSI=%s RDI=%s RBP=%s RSP=%s RIP=%s R8=%s R9=%s R10=%s R11=%s R12=%s R13=%s R14=%s R15=%s EFLAGS=%s", h(RAX), h(RBX), h(RCX), h(RDX), h(RSI), h(RDI), h(RBP), h(RSP), h(RIP), h(R8), h(R9), h(R10), h(R11), h(R12), h(R13), h(R14), h(R15), h(EFLAGS))',
          'else',
          '  parts[#parts+1] = string.format("EAX=%s EBX=%s ECX=%s EDX=%s ESI=%s EDI=%s EBP=%s ESP=%s EIP=%s EFLAGS=%s", h(EAX), h(EBX), h(ECX), h(EDX), h(ESI), h(EDI), h(EBP), h(ESP), h(EIP), h(EFLAGS))',
          'end',
          'for i=0,15 do',
          '  local ok, ptr = pcall(debug_getXMMPointer, i)',
          '  if ok and ptr then',
          '    local b = readBytes(ptr, 16, true)',
          '    if b then',
          '      local hex = {}',
          '      for j=1,16 do hex[j] = string.format("%02X", b[j]) end',
          '      parts[#parts+1] = string.format("XMM%d=%s", i, table.concat(hex, " "))',
          '    end',
          '  end',
          'end',
          'return table.concat(parts, " ")',
        ].join('\n'),
      }),
    },

    // ── 高级 / 脚本（危险） ───────────────────────────────────────
    {
      name: 'ce_execute_lua',
      description: '在 Cheat Engine 中执行任意 Lua 代码（高级/危险）',
      method: 'evaluate_lua',
      dangerous: true,
      parameters: {
        code: { type: 'string', required: true, description: 'Lua 代码，返回字符串结果' },
      },
    },
    {
      name: 'ce_auto_assemble',
      description: '执行 Auto Assembler 脚本（注入/代码洞穴等，危险）',
      method: 'auto_assemble',
      dangerous: true,
      parameters: {
        script: { type: 'string', required: true, description: 'AA 脚本' },
      },
    },

    {
      name: 'ce_find_what_writes',
      description: '一键查找谁改写了指定地址：自动设写入断点、等待触发、返回 RIP/反汇编/寄存器',
      method: 'ce_find_what_writes',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '要监控的地址' },
        access_type: { type: 'string', description: 'r|w|rw，默认 w' },
        size: { type: 'integer', description: '监控字节数，默认 4' },
        timeout_ms: { type: 'integer', description: '等待超时毫秒，默认 15000' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        if (!address) return { success: false, error: 'address is required' }
        const accessType = args.access_type || 'w'
        const size = Number(args.size) || 4
        const timeoutMs = Number(args.timeout_ms) || 15000
        const bpId = `find_${Date.now()}`
        const setRes = await client.sendCommand('set_data_breakpoint', { address, access_type: accessType, size, id: bpId })
        if (!setRes || setRes.success === false) return setRes || { success: false, error: 'set_data_breakpoint failed' }
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const hitsRes = await client.sendCommand('get_breakpoint_hits', { id: bpId, clear: false, limit: 10, offset: 0 })
          if (hitsRes && hitsRes.success !== false && Array.isArray(hitsRes.hits) && hitsRes.hits.length > 0) {
            const hit = hitsRes.hits[0]
            let disasm: any[] = []
            if (hit.registers && hit.registers.RIP) {
              const disRes = await client.sendCommand('disassemble', { address: hit.registers.RIP, count: 20, limit: 20 })
              if (disRes && Array.isArray(disRes.instructions)) disasm = disRes.instructions
            }
            await client.sendCommand('remove_breakpoint', { id: bpId }).catch(() => {})
            return { success: true, breakpoint_id: bpId, hit, disassembly: disasm }
          }
        }
        await client.sendCommand('remove_breakpoint', { id: bpId }).catch(() => {})
        return { success: false, error: `No write to ${address} within ${timeoutMs}ms`, breakpoint_id: bpId }
      },
    },
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
        if (res && res.success !== false) {
          session.undoStack.push({ kind: 'lock', address, value, type, ts: Date.now() })
        }
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
        return { success: true, address, lua_result: res }
      },
    },
    {
      name: 'ce_pointer_scan',
      description: '基础版指针扫描：从目标地址向上查找指向它的指针链（最多 max_depth 层）',
      method: 'ce_pointer_scan',
      dangerous: true,
      parameters: {
        address: { type: 'string', required: true, description: '目标地址' },
        max_depth: { type: 'integer', description: '最大层数，默认 3，最高 6' },
        max_results: { type: 'integer', description: '最多返回链数，默认 20' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        const maxDepth = Math.min(Number(args.max_depth) || 3, 6)
        const maxResults = Math.min(Number(args.max_results) || 20, 100)
        if (!address) return { success: false, error: 'address is required' }
        const target = Number.parseInt(address.replace(/^0x/i, ''), 16)
        if (!Number.isFinite(target)) return { success: false, error: 'invalid address' }
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        const scanPointersTo = async (addr: number) => {
          const lua = [
            `local target = ${addr}`,
            `local ms = createMemScan()`,
            `ms.firstScan(soExactValue, vtQword, rtRounded, string.format("%d", target), nil, 0, 0x7FFFFFFFFFFFFFFF, "+R", fsmNotAligned, "1", false, false, false, false)`,
            `ms.waitTillDone()`,
            `local fl = createFoundList(ms)`,
            `fl.initialize()`,
            `local out = {}`,
            `for i=0, fl.Count-1 do`,
            `  local a = tonumber(fl.getAddress(i), 16)`,
            `  if a then out[#out+1] = string.format("%X", a) end`,
            `end`,
            `fl.destroy()`,
            `ms.destroy()`,
            `return table.concat(out, ",")`,
          ].join('\n')
          const res = await client.sendCommand('evaluate_lua', { code: lua })
          const text = res && typeof res.result === 'string' ? res.result : ''
          if (!text) return []
          return text.split(',').filter(Boolean).map((s: string) => Number.parseInt(s, 16)).filter((n: number) => Number.isFinite(n))
        }
        let chains: number[][] = [[target]]
        for (let depth = 1; depth <= maxDepth; depth++) {
          const newChains: number[][] = []
          for (const chain of chains) {
            const head = chain[0]
            const ptrs = await scanPointersTo(head)
            for (const ptr of ptrs) {
              newChains.push([ptr, ...chain])
              if (newChains.length >= maxResults) break
            }
            if (newChains.length >= maxResults) break
          }
          chains = newChains
          if (chains.length === 0) break
          await sleep(100)
        }
        const formatted = chains.slice(0, maxResults).map((chain) => chain.map((a) => '0x' + a.toString(16).toUpperCase()))
        return { success: true, target: address, max_depth: maxDepth, count: formatted.length, chains: formatted }
      },
    },
    {
      name: 'ce_detect_engine',
      description: '识别当前附加进程的常见游戏引擎（Unity/Unreal/Godot/Source 等）',
      method: 'ce_detect_engine',
      async execute(args: any, client: any) {
        const info = await client.sendCommand('get_process_info', {})
        if (!info || info.success === false) return info || { success: false, error: 'get_process_info failed' }
        const mods = Array.isArray(info.modules) ? info.modules.map((m: any) => String(m.name || '').toLowerCase()) : []
        const detect = (names: string[]) => names.some((n) => mods.some((m: string) => m.includes(n)))
        let engine = 'unknown'
        if (detect(['unityplayer.dll', 'gameassembly.dll', 'mono-2.0-bdwgc.dll'])) engine = 'Unity'
        else if (detect(['unrealengine', 'ue4-', 'ue5-', 'unreal'])) engine = 'Unreal Engine'
        else if (detect(['godot'])) engine = 'Godot'
        else if (detect(['engine.dll', 'source2', 'vphysics'])) engine = 'Source/Source2'
        return { success: true, process_name: info.process_name, process_id: info.process_id, engine, modules: info.modules }
      },
    },
    {
      name: 'install_ce_bridge',
      description: '一键安装 CE 桥接：自动探测或指定 CE 目录，复制 ce_mcp_bridge.lua 和 ce_mcp_tcp_x64/x86.dll，并写入 autorun 自动启动脚本',
      method: 'install_ce_bridge',
      dangerous: true,
      parameters: {
        ce_dir: { type: 'string', description: 'Cheat Engine 安装目录，如 D:\\Game\\Cheat Engine 7.6；缺省自动探测常见路径' },
        source_dir: { type: 'string', required: true, description: '桥接文件所在目录（含 ce_mcp_bridge.lua 和 ce_mcp_tcp_*.dll）' },
      },
      async execute(args: any) {
        const sourceDir = String(args.source_dir || '').trim()
        if (!sourceDir) return { success: false, error: 'source_dir is required', error_class: 'INVALID_ARGS' }
        let ceDir = String(args.ce_dir || '').trim()
        if (!ceDir) {
          const candidates = [
            process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Cheat Engine') : '',
            process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Cheat Engine') : '',
            'D:\\Game\\Cheat Engine 7.6',
            'D:\\Cheat Engine',
            'C:\\Cheat Engine',
          ].filter(Boolean)
          for (const c of candidates) {
            try {
              await fs.access(c)
              ceDir = c
              break
            } catch { /* keep looking */ }
          }
        }
        if (!ceDir) return { success: false, error: 'ce_dir is required (auto-detect failed)', error_class: 'CE_DIR_NOT_FOUND' }
        const files = ['ce_mcp_bridge.lua', 'ce_mcp_tcp_x64.dll', 'ce_mcp_tcp_x86.dll']
        const copied: string[] = []
        for (const f of files) {
          const src = path.join(sourceDir, f)
          const dst = path.join(ceDir, f)
          try {
            await fs.copyFile(src, dst)
            copied.push(dst)
          } catch (err: any) {
            return { success: false, error: `copy ${f} failed: ${String((err && err.message) || err)}`, copied }
          }
        }
        const autorunDir = path.join(ceDir, 'autorun')
        await fs.mkdir(autorunDir, { recursive: true })
        const autorunScript = `loadfile("${ceDir.replace(/\\/g, '\\\\')}\\\\ce_mcp_bridge.lua")()` + '\n'
        const autorunPath = path.join(autorunDir, 'start_mcp_bridge.lua')
        await fs.writeFile(autorunPath, autorunScript, 'utf8')
        copied.push(autorunPath)
        return { success: true, copied, ce_dir: ceDir }
      },
    },
    {
      name: 'ce_session_stats',
      description: '查看当前 CE 调试会话的统计信息：阶段、调用次数、扫描候选数、锁定列表等',
      method: 'ce_session_stats',
      async execute() {
        const elapsedMs = Date.now() - session.startTime
        return {
          success: true,
          phase: session.phase,
          call_count: session.calls.length,
          elapsed_ms: elapsedMs,
          elapsed_seconds: Math.round(elapsedMs / 1000),
          scan_count: session.scanCount,
          locked_addresses: Array.from(session.locks),
          cache_size: session.cache.size,
          recent_calls: session.calls.slice(-20).reverse().map((c: any) => ({ tool: c.tool, ts: c.ts, ok: c.ok, error_class: c.error_class || null })),
        }
      },
    },
    {
      name: 'ce_cache_status',
      description: '查看插件内部缓存（已扫描过的值/类型/候选数）',
      method: 'ce_cache_status',
      async execute() {
        const entries: any[] = []
        session.cache.forEach((v: any, k: string) => entries.push({ key: k, ...v }))
        return { success: true, cache_size: entries.length, entries }
      },
    },
    {
      name: 'ce_forget',
      description: '清除插件内部缓存；不传 key 则清空全部',
      method: 'ce_forget',
      parameters: {
        key: { type: 'string', description: '要清除的缓存 key（如扫描值），缺省清空全部' },
      },
      async execute(args: any) {
        const key = args.key ? String(args.key) : null
        if (key) {
          session.cache.delete(key)
          return { success: true, cleared: key }
        }
        session.cache.clear()
        return { success: true, cleared: 'all' }
      },
    },
    {
      name: 'ce_scan_many',
      description: '批量扫描多个值，返回每个值的候选数（最后一次扫描会保留为当前扫描状态）',
      method: 'ce_scan_many',
      parameters: {
        values: { type: 'array', items: { type: 'string' }, required: true, description: '要扫描的值数组，如 ["100","200"]' },
        type: { type: 'string', description: 'byte|word|dword|qword|float|double|string，默认 dword' },
        protection: { type: 'string', description: '内存保护，默认 +W-C' },
      },
      async execute(args: any, client: any) {
        const values = Array.isArray(args.values) ? args.values.map(String) : []
        if (values.length === 0) return { success: false, error: 'values is required', error_class: 'INVALID_ARGS' }
        const type = args.type || 'dword'
        const protection = args.protection || '+W-C'
        const results: any[] = []
        for (const value of values) {
          const res = await client.sendCommand('scan_all', { value, type, protection })
          results.push({ value, count: res && res.count, success: !(res && res.success === false) })
        }
        return { success: true, type, results }
      },
    },
    {
      name: 'ce_read_many',
      description: '批量读取多个地址的数值',
      method: 'ce_read_many',
      parameters: {
        addresses: { type: 'array', items: { type: 'string' }, required: true, description: '地址数组，如 ["0x1000","0x2000"]' },
        type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
        max_results: { type: 'integer', description: '最多返回条数，默认 100' },
      },
      async execute(args: any, client: any) {
        let addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : []
        if (addresses.length === 0) return { success: false, error: 'addresses is required', error_class: 'INVALID_ARGS' }
        const maxResults = Math.min(Number(args.max_results) || 100, 1000)
        const truncated = addresses.length > maxResults
        addresses = addresses.slice(0, maxResults)
        const type = args.type || 'dword'
        const results: any[] = []
        for (const address of addresses) {
          const res = await client.sendCommand('read_integer', { address, type })
          results.push({ address, value: res && res.value, success: !(res && res.success === false) })
        }
        return { success: true, type, results, truncated }
      },
    },
    {
      name: 'ce_write_many',
      description: '批量写入多个地址的数值（危险）',
      method: 'ce_write_many',
      dangerous: true,
      parameters: {
        addresses: { type: 'array', items: { type: 'string' }, required: true, description: '地址数组' },
        values: { type: 'array', items: { type: 'number' }, required: true, description: '值数组，与 addresses 一一对应' },
        type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
        max_results: { type: 'integer', description: '最多处理/返回条数，默认 100' },
      },
      async execute(args: any, client: any) {
        let addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : []
        const values = Array.isArray(args.values) ? args.values.map(Number) : []
        if (addresses.length === 0 || addresses.length !== values.length) {
          return { success: false, error: 'addresses and values must be non-empty arrays of same length', error_class: 'INVALID_ARGS' }
        }
        const maxResults = Math.min(Number(args.max_results) || 100, 1000)
        const truncated = addresses.length > maxResults
        addresses = addresses.slice(0, maxResults)
        const type = args.type || 'dword'
        const results: any[] = []
        for (let i = 0; i < addresses.length; i++) {
          const beforeRes = await client.sendCommand('read_integer', { address: addresses[i], type })
          const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null
          const res = await client.sendCommand('write_integer', { address: addresses[i], value: values[i], type })
          results.push({ address: addresses[i], value: values[i], success: !(res && res.success === false) })
          if (res && res.success !== false) {
            session.undoStack.push({ kind: 'write', address: addresses[i], type, before, after: values[i], ts: Date.now() })
          }
        }
        return { success: true, type, results, truncated }
      },
    },
    {
      name: 'ce_budget_status',
      description: '查看当前会话的预算/消耗情况（兼容别名，推荐使用 ce_session_stats）',
      method: 'ce_budget_status',
      async execute() {
        const elapsedMs = Date.now() - session.startTime
        return {
          success: true,
          call_count: session.calls.length,
          elapsed_ms: elapsedMs,
          elapsed_seconds: Math.round(elapsedMs / 1000),
          scan_count: session.scanCount,
          phase: session.phase,
        }
      },
    },
    {
      name: 'ce_audit_log',
      description: '查看本会话的危险操作审计日志',
      method: 'ce_audit_log',
      async execute() {
        return { success: true, count: session.audit.length, entries: session.audit.slice(-50).reverse() }
      },
    },
    {
      name: 'ce_snapshot_save',
      description: '保存当前会话状态快照（阶段、锁定列表、缓存）',
      method: 'ce_snapshot_save',
      async execute() {
        snapshot = {
          phase: session.phase,
          scanCount: session.scanCount,
          locks: Array.from(session.locks),
          cache: Array.from(session.cache.entries()),
          ts: Date.now(),
        }
        return { success: true, saved: true, phase: snapshot.phase, locks: snapshot.locks, cache_size: snapshot.cache.length, ts: snapshot.ts }
      },
    },
    {
      name: 'ce_snapshot_load',
      description: '加载最近一次保存的会话状态快照',
      method: 'ce_snapshot_load',
      async execute() {
        if (!snapshot) return { success: false, error: 'no snapshot saved', error_class: 'NO_SNAPSHOT' }
        session.phase = snapshot.phase
        session.scanCount = snapshot.scanCount
        session.locks = new Set(snapshot.locks)
        session.cache = new Map(snapshot.cache)
        return { success: true, phase: session.phase, scan_count: session.scanCount, locks: Array.from(session.locks), cache_size: session.cache.size }
      },
    },
    {
      name: 'ce_risk_levels',
      description: '查看危险工具的风险分级',
      method: 'ce_risk_levels',
      async execute() {
        return {
          success: true,
          levels: {
            L1_read_only: ['ce_read_memory', 'ce_read_integer', 'ce_read_string', 'ce_disassemble', 'ce_get_scan_results', 'ce_get_breakpoint_hits'],
            L2_scan_analysis: ['ce_scan', 'ce_next_scan', 'ce_aob_scan', 'ce_pointer_scan', 'ce_detect_engine'],
            L3_write_breakpoint: ['ce_write_integer', 'ce_write_memory', 'ce_write_string', 'ce_set_breakpoint', 'ce_set_data_breakpoint', 'ce_remove_breakpoint', 'ce_clear_breakpoints', 'ce_lock_address', 'ce_unlock_address', 'ce_find_what_writes'],
            L4_script_inject: ['ce_execute_lua', 'ce_auto_assemble', 'install_ce_bridge'],
          },
        }
      },
    },
    {
      name: 'ce_hypothesis',
      description: '记录/查看/清除调试假设，避免重复验证同一方向',
      method: 'ce_hypothesis',
      parameters: {
        action: { type: 'string', description: 'add|list|clear，默认 list' },
        id: { type: 'string', description: '假设 ID（add 时可选，list 时可按 ID 过滤）' },
        statement: { type: 'string', description: '假设内容（add 时需要）' },
        result: { type: 'string', description: '验证结果（add 时可选）' },
      },
      async execute(args: any) {
        const action = args.action || 'list'
        if (action === 'clear') {
          session.hypotheses = []
          return { success: true, cleared: true }
        }
        if (action === 'add') {
          const id = args.id || `H${session.hypotheses.length + 1}`
          session.hypotheses.push({ id, statement: args.statement || '', result: args.result || null, ts: Date.now() })
          return { success: true, id, count: session.hypotheses.length }
        }
        const id = args.id ? String(args.id) : null
        const entries = id ? session.hypotheses.filter((h: any) => h.id === id) : session.hypotheses
        return { success: true, count: entries.length, entries }
      },
    },
    {
      name: 'ce_undo_last',
      description: '撤销最近一次可撤销的危险操作（支持锁定、整数写入、字节写入、字符串写入）',
      method: 'ce_undo_last',
      dangerous: true,
      async execute(args: any, client: any) {
        const last = session.undoStack.pop()
        if (!last) return { success: false, error: 'no dangerous operation to undo', error_class: 'NOTHING_TO_UNDO' }
        if (last.kind === 'lock' && last.address) {
          const addr = String(last.address)
          await client.sendCommand('evaluate_lua', {
            code: [
              `local addr = ${Number.parseInt(addr.replace(/^0x/i, ''), 16)}`,
              `if _G.__mcp_locks and _G.__mcp_locks[addr] then _G.__mcp_locks[addr].destroy(); _G.__mcp_locks[addr] = nil end`,
              `return "unlocked"`,
            ].join('\n'),
          })
          session.locks.delete(addr)
          return { success: true, undone: 'ce_lock_address', address: addr }
        }
        if (last.kind === 'write' && last.address) {
          if (last.before === null || last.before === undefined) {
            return { success: false, error: 'cannot undo write: previous value unknown', error_class: 'UNDO_NOT_SUPPORTED' }
          }
          const res = await client.sendCommand('write_integer', { address: last.address, value: last.before, type: last.type || 'dword' })
          return { success: !(res && res.success === false), undone: 'ce_write_integer', address: last.address, restored: last.before }
        }
        if (last.kind === 'write_memory' && last.address) {
          if (!Array.isArray(last.before)) return { success: false, error: 'cannot undo write_memory: previous bytes unknown', error_class: 'UNDO_NOT_SUPPORTED' }
          const res = await client.sendCommand('write_memory', { address: last.address, bytes: last.before })
          return { success: !(res && res.success === false), undone: 'ce_write_memory', address: last.address, restored: last.before }
        }
        if (last.kind === 'write_string' && last.address) {
          if (last.before === null || last.before === undefined) return { success: false, error: 'cannot undo write_string: previous string unknown', error_class: 'UNDO_NOT_SUPPORTED' }
          const res = await client.sendCommand('write_string', { address: last.address, value: last.before, wide: !!last.wide })
          return { success: !(res && res.success === false), undone: 'ce_write_string', address: last.address, restored: last.before }
        }
        return { success: false, error: `cannot undo ${last.kind} automatically`, error_class: 'UNDO_NOT_SUPPORTED' }
      },
    },
    {
      name: 'ce_playbook',
      description: '返回针对常见调试任务的推荐方法论（建议而非强制，Agent 可自行组合工具）',
      method: 'ce_playbook',
      parameters: {
        task: { type: 'string', description: 'overview|find_value|find_base|lock_value|verify_address，默认 overview' },
        engine: { type: 'string', description: '可选：unity|ue|godot|unknown，用于给引擎相关建议' },
      },
      async execute(args: any) {
        const task = args.task || 'overview'
        const engine = args.engine || ''
        const playbooks: Record<string, any> = {
          overview: {
            summary: '先确认环境，再根据目标选择路线。',
            phases: [
              { name: '环境确认', tools: ['ce_status', 'ce_connect', 'ce_process_info', 'ce_detect_engine'], note: '确认 CE 已附加目标进程' },
              { name: '选择路线', tools: ['ce_playbook'], note: '根据任务类型选择 find_value / find_base / lock_value' },
            ],
          },
          find_value: {
            summary: '定位一个会变化的内存数值。',
            phases: [
              { name: '初次扫描', tools: ['ce_scan'], decision: '如果候选过多，尝试 float/double/word/qword', stop_condition: '三种类型都为 0 → 停止，可能不是普通内存数值' },
              { name: '过滤变化', tools: ['ce_next_scan'], decision: '使用 exact / increased / decreased / changed', stop_condition: '候选为 1 → 进入验证' },
              { name: '验证', tools: ['ce_read_integer', 'ce_write_integer'], decision: '直接写入是否生效？不生效找写入者', stop_condition: '写入不生效 → ce_find_what_writes' },
              { name: '稳定化', tools: ['ce_pointer_scan', 'ce_lock_address'], note: '需要稳定地址再做指针扫描' },
            ],
          },
          find_base: {
            summary: '从动态地址向上找稳定基址/指针链。',
            phases: [
              { name: '定位当前地址', tools: ['ce_scan', 'ce_next_scan', 'ce_find_what_writes'], note: '先拿到一个可用的动态地址' },
              { name: '指针扫描', tools: ['ce_pointer_scan'], decision: '从目标地址向上找指针链', stop_condition: '5 层内无静态指针 → 大概率没有稳定基址' },
              { name: '验证链', tools: ['ce_read_pointer_chain', 'ce_write_integer'], note: '用链读取/写入验证' },
            ],
          },
          lock_value: {
            summary: '把某个地址锁定为指定值。',
            phases: [
              { name: '确认地址', tools: ['ce_read_integer'], note: '确认地址当前值' },
              { name: '锁定', tools: ['ce_lock_address'], note: '设置锁定值和间隔' },
              { name: '验证', tools: ['ce_read_integer', 'ce_session_stats'], note: '确认锁定后值不变' },
            ],
          },
          verify_address: {
            summary: '验证一个地址是否真实控制目标数值。',
            phases: [
              { name: '读取', tools: ['ce_read_integer'], note: '确认地址值' },
              { name: '写入测试', tools: ['ce_write_integer'], decision: '游戏显示是否变化？', stop_condition: '没变化 → 可能是显示副本，用 ce_find_what_writes' },
              { name: '写入断点', tools: ['ce_find_what_writes'], note: '找到真正写入者' },
            ],
          },
        }
        const pb = playbooks[task] || playbooks.overview
        if (engine) pb.engine_note = engine === 'unity' ? 'Unity/IL2CPP 优先尝试 float/double，注意 UI 显示副本。' : engine === 'ue' ? 'UE 通常需要指针链，动态堆较多。' : engine === 'godot' ? 'Godot 脚本值可能在 VM 堆中。' : ''
        return { success: true, task, playbook: pb }
      },
    },
    {
      name: 'ce_evidence',
      description: '记录/查看/清除结构化调试证据，形成可追溯的调查链',
      method: 'ce_evidence',
      parameters: {
        action: { type: 'string', description: 'add|list|clear，默认 list' },
        claim: { type: 'string', description: '结论/主张（add 时需要）' },
        method: { type: 'string', description: '验证方法，如 ce_scan / ce_write_integer' },
        result: { type: 'string', description: '证据内容/结果' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 ["unity","display-copy"]' },
      },
      async execute(args: any) {
        const action = args.action || 'list'
        if (action === 'clear') {
          session.evidence = []
          return { success: true, cleared: true }
        }
        if (action === 'add') {
          const entry = {
            id: `E${session.evidence.length + 1}`,
            claim: args.claim || '',
            method: args.method || '',
            result: args.result || '',
            tags: Array.isArray(args.tags) ? args.tags : [],
            ts: Date.now(),
          }
          session.evidence.push(entry)
          return { success: true, id: entry.id, count: session.evidence.length }
        }
        return { success: true, count: session.evidence.length, entries: session.evidence.slice(-50).reverse() }
      },
    },
    {
      name: 'ce_cheat_table_save',
      description: '保存当前 Cheat Table 到 .CT 文件',
      method: 'save_table',
      parameters: {
        filename: { type: 'string', required: true, description: '保存路径，如 D:\\tables\\my.ct' },
        protect: { type: 'boolean', description: '是否加密/保护，默认 false' },
      },
    },
    {
      name: 'ce_cheat_table_load',
      description: '加载 .CT Cheat Table 文件',
      method: 'load_table',
      parameters: {
        filename: { type: 'string', required: true, description: '要加载的 .CT 文件路径' },
        merge: { type: 'boolean', description: '是否合并到当前表，默认 false' },
      },
    },
    {
      name: 'ce_speedhack',
      description: '设置 CE 变速齿轮速度（需要先在 CE 中启用 Speedhack）',
      method: 'ce_speedhack',
      dangerous: true,
      parameters: {
        speed: { type: 'number', required: true, description: '速度倍率，如 0.5、1.0、2.0' },
      },
      async execute(args: any, client: any) {
        const speed = Number(args.speed)
        if (!Number.isFinite(speed) || speed <= 0) return { success: false, error: 'speed must be a positive number', error_class: 'INVALID_ARGS' }
        const lua = [
          `if getAddressSafe("speedhack_wantedspeed") == nil then`,
          `  return "NOT_READY"`,
          `end`,
          `writeFloat("speedhack_wantedspeed", ${speed})`,
          `return "OK"`,
        ].join('\n')
        const res = await client.sendCommand('evaluate_lua', { code: lua })
        return { success: true, speed, status: res && res.result ? res.result : String((res && res.error) || '') }
      },
    },
    {
      name: 'ce_dump_module',
      description: '把指定模块的内存转储到文件（用于离线分析/脱壳辅助）',
      method: 'ce_dump_module',
      dangerous: true,
      parameters: {
        module: { type: 'string', required: true, description: '模块名，如 GameAssembly.dll' },
        output: { type: 'string', required: true, description: '输出文件路径，如 D:\\dumps\\GameAssembly.bin' },
      },
      async execute(args: any, client: any) {
        const moduleName = String(args.module || '').trim()
        const output = String(args.output || '').trim()
        if (!moduleName || !output) return { success: false, error: 'module and output are required', error_class: 'INVALID_ARGS' }
        const info = await client.sendCommand('get_process_info', {})
        const mods = Array.isArray(info && info.modules) ? info.modules : []
        const mod = mods.find((m: any) => String(m.name || '').toLowerCase() === moduleName.toLowerCase() || String(m.name || '').toLowerCase().includes(moduleName.toLowerCase()))
        if (!mod) return { success: false, error: `module ${moduleName} not found`, error_class: 'MODULE_NOT_FOUND' }
        const base = Number.parseInt(String(mod.address).replace(/^0x/i, ''), 16)
        const size = Number(mod.size)
        const lua = [
          `local base = ${base}`,
          `local size = ${size}`,
          `local f = io.open("${output.replace(/\\/g, '\\\\')}", "wb")`,
          `if not f then return "OPEN_FAILED" end`,
          `local chunk = 0x1000`,
          `for off = 0, size - 1, chunk do`,
          `  local len = math.min(chunk, size - off)`,
          `  local bytes = readBytes(base + off, len, true)`,
          `  if not bytes then f:close(); return "READ_FAILED" end`,
          `  f:write(string.char(table.unpack(bytes)))`,
          `end`,
          `f:close()`,
          `return "DUMPED"`,
        ].join('\n')
        const res = await client.sendCommand('evaluate_lua', { code: lua })
        return { success: true, module: mod.name, base: mod.address, size, output, status: res && res.result ? res.result : String((res && res.error) || '') }
      },
    },
    {
      name: 'ce_aob_generate',
      description: '从指定地址读取字节并生成 AOB 特征码',
      method: 'ce_aob_generate',
      parameters: {
        address: { type: 'string', required: true, description: '起始地址，如 0x7FFEA2110000' },
        size: { type: 'integer', description: '读取字节数，默认 32' },
      },
      async execute(args: any, client: any) {
        const address = String(args.address || '').trim()
        const size = Math.min(Number(args.size) || 32, 256)
        if (!address) return { success: false, error: 'address is required', error_class: 'INVALID_ARGS' }
        const lua = [
          `local addr = getAddressSafe("${address}")`,
          `if not addr then return "INVALID_ADDRESS" end`,
          `local bytes = readBytes(addr, ${size}, true)`,
          `if not bytes then return "READ_FAILED" end`,
          `local parts = {}`,
          `for i = 1, #bytes do parts[i] = string.format("%02X", bytes[i]) end`,
          `return table.concat(parts, " ")`,
        ].join('\n')
        const res = await client.sendCommand('evaluate_lua', { code: lua })
        const pattern = typeof res && typeof res.result === 'string' ? res.result : ''
        return { success: true, address, size, pattern }
      },
    },
    {
      name: 'ce_detect_protection',
      description: '检测已加载的反作弊/保护模块（EasyAntiCheat/BattlEye/Denuvo/VMProtect/Themida 等）',
      method: 'ce_detect_protection',
      async execute(args: any, client: any) {
        const info = await client.sendCommand('get_process_info', {})
        if (!info || info.success === false) return info || { success: false, error: 'get_process_info failed', error_class: 'NO_PROCESS' }
        const mods = Array.isArray(info.modules) ? info.modules : []
        const names = mods.map((m: any) => String(m.name || '').toLowerCase())
        const protections = [
          { name: 'EasyAntiCheat', patterns: ['easyanticheat', 'easyanticheat_eos'] },
          { name: 'BattlEye', patterns: ['battleye', 'beds.dll'] },
          { name: 'Vanguard', patterns: ['vgk.sys', 'vanguard'] },
          { name: 'Denuvo', patterns: ['denuvo'] },
          { name: 'VMProtect', patterns: ['vmprotect'] },
          { name: 'Themida', patterns: ['themida', 'winlicense'] },
          { name: 'XIGNCODE', patterns: ['xigncode'] },
        ]
        const detected = protections.filter((p) => p.patterns.some((pat) => names.some((n: string) => n.includes(pat))))
        return {
          success: true,
          process_name: info.process_name,
          process_id: info.process_id,
          risk: detected.length > 0 ? 'protected' : 'none',
          detected,
          module_count: mods.length,
        }
      },
    },
    {
      name: 'ce_mission',
      description: '任务入口：根据目标返回推荐工具序列、当前阶段与停止条件（建议而非强制）',
      method: 'ce_mission',
      parameters: {
        goal: { type: 'string', required: true, description: 'detect_environment|find_value|find_base|lock_value|verify_address' },
        current_value: { type: 'integer', description: '当前数值（可选）' },
        engine: { type: 'string', description: 'unity|ue|godot|unknown（可选）' },
        phase: { type: 'string', description: 'idle|scanning|filtering|verifying|tracing|locked（可选）' },
      },
      async execute(args: any) {
        const goal = args.goal || 'detect_environment'
        const phase = args.phase || 'idle'
        const missions: Record<string, any> = {
          detect_environment: {
            phases: ['ce_connect', 'ce_process_info', 'ce_detect_engine', 'ce_detect_protection'],
            next_action: '确认 CE 已附加目标进程后进入 find_value 或 find_base',
            stop_condition: '无法连接或未附加进程时停止',
          },
          find_value: {
            phases: ['ce_scan', 'ce_next_scan', 'ce_get_scan_results', 'ce_read_integer', 'ce_write_integer', 'ce_find_what_writes'],
            next_action: phase === 'idle' ? '先用 ce_scan 扫描当前值' : phase === 'scanning' ? '让用户改变数值后 ce_next_scan' : phase === 'filtering' ? '候选少时 ce_get_scan_results 并验证' : '继续验证或找写入者',
            stop_condition: '多种类型均为 0 → 停止；写入不生效 → 找写入者',
          },
          find_base: {
            phases: ['ce_scan', 'ce_find_what_writes', 'ce_pointer_scan', 'ce_read_pointer_chain'],
            next_action: '先拿到一个动态地址，再 ce_pointer_scan',
            stop_condition: '5 层内无静态指针 → 报告无稳定基址',
          },
          lock_value: {
            phases: ['ce_read_integer', 'ce_lock_address', 'ce_read_integer', 'ce_session_stats'],
            next_action: '确认地址后 ce_lock_address',
            stop_condition: '锁定后值仍变化 → 可能锁的是显示副本',
          },
          verify_address: {
            phases: ['ce_read_integer', 'ce_write_integer', 'ce_find_what_writes'],
            next_action: '先读，再写测试',
            stop_condition: '写入不生效 → 显示副本',
          },
        }
        const mission = missions[goal] || missions.detect_environment
        if (args.engine === 'unity') mission.engine_note = 'Unity/IL2CPP 优先尝试 float/double，注意 UI 显示副本。'
        return { success: true, goal, phase, mission }
      },
    },
    {
      name: 'ce_explain_scan_result',
      description: '解释一次扫描结果（count/type），给出下一步建议',
      method: 'ce_explain_scan_result',
      parameters: {
        count: { type: 'integer', required: true, description: '扫描返回的匹配数量' },
        type: { type: 'string', description: '扫描类型，如 dword/float/double' },
      },
      async execute(args: any) {
        const count = Number(args.count) || 0
        const type = args.type || 'dword'
        let interpretation: string
        let suggestion: string
        if (count === 0) {
          interpretation = '没有找到匹配。'
          suggestion = '尝试其他类型（float/double/word/qword），或改用 ce_find_what_writes。'
        } else if (count <= 10) {
          interpretation = '候选很少，非常适合逐个验证。'
          suggestion = '使用 ce_get_scan_results 读取候选并逐个写入测试。'
        } else if (count <= 1000) {
          interpretation = '候选较多，需要继续过滤。'
          suggestion = '让用户改变数值后用 ce_next_scan 精确过滤，或使用分页读取前若干。'
        } else {
          interpretation = '候选非常多，当前扫描太宽。'
          suggestion = '尝试更精确的扫描类型/保护范围，或改用 unknown initial value + changed。'
        }
        return { success: true, count, type, interpretation, suggestion }
      },
    },
    {
      name: 'ce_status_report',
      description: '生成人类可读的会话状态报告（Markdown），便于用户查看当前调试进度',
      method: 'ce_status_report',
      async execute() {
        const elapsedMs = Date.now() - session.startTime
        const lines: string[] = []
        lines.push('# CE Debug Session Report')
        lines.push('')
        lines.push(`- **Phase**: ${session.phase}`)
        lines.push(`- **Calls**: ${session.calls.length}`)
        lines.push(`- **Elapsed**: ${Math.round(elapsedMs / 1000)}s`)
        lines.push(`- **Scan count**: ${session.scanCount}`)
        lines.push(`- **Locked addresses**: ${session.locks.size}`)
        lines.push(`- **Evidence**: ${session.evidence.length}`)
        lines.push(`- **Hypotheses**: ${session.hypotheses.length}`)
        lines.push(`- **Cache size**: ${session.cache.size}`)
        lines.push('')
        if (session.locks.size > 0) {
          lines.push('## Locked')
          lines.push('')
          for (const addr of session.locks) lines.push(`- ${addr}`)
          lines.push('')
        }
        if (session.evidence.length > 0) {
          lines.push('## Recent evidence')
          lines.push('')
          for (const e of session.evidence.slice(-5).reverse()) {
            lines.push(`- [${e.id}] ${e.method}: ${e.result}`)
          }
          lines.push('')
        }
        return { success: true, report: lines.join('\n') }
      },
    },
    {
      name: 'ce_analyst',
      description: '根据当前会话状态生成一段人类可读的调试总结（非阻塞，供状态面板/用户查看）',
      method: 'ce_analyst',
      async execute() {
        const lines: string[] = []
        if (session.phase === 'idle' || session.phase === '') {
          lines.push('尚未开始调试，等待 Agent 发起扫描或附加进程。')
        } else if (session.phase === 'scanning') {
          lines.push(`正在扫描数值，当前找到 ${session.scanCount} 个候选。`)
        } else if (session.phase === 'filtering') {
          lines.push(`正在过滤候选，当前剩余 ${session.scanCount} 个。`)
        } else if (session.phase === 'verifying') {
          lines.push('正在验证地址是否真实控制目标值。')
        } else if (session.phase === 'tracing') {
          lines.push('正在追踪写入者，定位真正的数据源。')
        } else if (session.phase === 'locked') {
          lines.push(`已锁定 ${session.locks.size} 个地址，资源不再消耗。`)
        } else {
          lines.push(`当前阶段：${session.phase}。`)
        }
        if (session.evidence.length > 0) lines.push(`已记录 ${session.evidence.length} 条证据。`)
        if (session.hypotheses.length > 0) lines.push(`已有 ${session.hypotheses.length} 个假设。`)
        if (session.audit.length > 0) lines.push(`执行了 ${session.audit.length} 个危险操作。`)
        session.summary = lines.join(' ')
        return { success: true, summary: session.summary, phase: session.phase }
      },
    },
    // ── 按需解锁（常驻） ──────────────────────────────────────────
    {
      name: 'ce_tool_search',
      description: [
        '搜索并解锁当前不可见的 ce_* 工具。',
        '本会话默认只暴露 ce_status、ce_connect。需要其他 Cheat Engine 工具时，先调用本工具搜索，再用 toolNames 精确解锁。',
        '危险工具（写内存/断点/脚本）解锁后请谨慎使用。',
      ].join(' '),
      kind: 'search',
      method: 'ce_tool_search',
      parameters: {
        query: { type: 'string', description: '搜索关键词，如 "scan"、"read"、"breakpoint"' },
        toolNames: { type: 'array', items: { type: 'string' }, description: '要解锁的精确工具名数组，如 ["ce_scan"]' },
      },
    },
  ]
}

function recordAutoEvidence(toolName: string, args: any, result: any): void {
  if (!result || result.success === false) return
  let entry: any = null
  if (toolName === 'ce_scan') {
    entry = { claim: `scan ${args.value}`, method: 'ce_scan', result: `count=${result.count}`, tags: ['scan'] }
  } else if (toolName === 'ce_next_scan') {
    entry = { claim: `next_scan ${args.value}`, method: 'ce_next_scan', result: `count=${result.count}`, tags: ['scan'] }
  } else if (toolName === 'ce_find_what_writes') {
    entry = { claim: `find writes to ${args.address}`, method: 'ce_find_what_writes', result: `hit=${result.hit && result.hit.instruction ? result.hit.instruction : 'none'}`, tags: ['trace'] }
  } else if (toolName === 'ce_write_integer') {
    entry = { claim: `write ${args.address}`, method: 'ce_write_integer', result: `value=${result.value}`, tags: ['write'] }
  } else if (toolName === 'ce_lock_address') {
    entry = { claim: `lock ${args.address}`, method: 'ce_lock_address', result: `value=${args.value}`, tags: ['lock'] }
  } else if (toolName === 'ce_pointer_scan') {
    entry = { claim: `pointer scan ${args.address}`, method: 'ce_pointer_scan', result: `chains=${result.count}`, tags: ['pointer'] }
  } else if (toolName === 'ce_detect_protection') {
    entry = { claim: 'protection scan', method: 'ce_detect_protection', result: `risk=${result.risk}`, tags: ['protection'] }
  }
  if (entry) {
    entry.id = `E${session.evidence.length + 1}`
    entry.ts = Date.now()
    session.evidence.push(entry)
    if (session.evidence.length > 200) session.evidence.shift()
  }
}
function buildTool(ctx: Context, client: CEClient, def: ToolDef) {
  const description = def.dangerous
    ? `[危险操作-改内存/调试] ${def.description}`
    : def.description

  if (def.kind === 'search') {
    return defineTool({
      name: def.name,
      description,
      parameters: def.parameters || {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: any) => [
          { type: 'text', text: value.text || JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args: any, exec: any) {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        const unlock = Array.isArray(args.toolNames)
          ? args.toolNames.filter((name: unknown) => typeof name === 'string' && name.length > 0)
          : []
        const lines: string[] = []
        let schemas: any[] = []
        try {
          schemas = ctx.tools.schemas(exec?.agent) || []
        } catch (err: any) {
          lines.push(`目录搜索不可用：${String((err && err.message) || err)}`)
        }
        const ceSchemas = schemas.filter((schema) => schema.name.startsWith('ce_'))

        if (unlock.length > 0) {
          const valid = ceSchemas.filter((schema) => unlock.includes(schema.name))
          const invalid = unlock.filter((name: string) => !ceSchemas.some((schema) => schema.name === name))
          lines.push(`将在下一请求解锁：${valid.map((schema) => schema.name).join(', ') || '(无)'}`)
          if (invalid.length > 0) lines.push(`未找到：${invalid.join(', ')}`)
          const dangerous = valid.filter((schema) => (schema.description || '').startsWith('[危险操作'))
          if (dangerous.length > 0) {
            lines.push(`注意：以下为危险工具，请谨慎使用：${dangerous.map((schema) => schema.name).join(', ')}`)
          }
        }

        if (query.length > 0) {
          const tokens = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)
          const matches = ceSchemas
            .filter((schema) => {
              const haystack = `${schema.name} ${schema.description || ''}`.toLowerCase()
              return tokens.every((token: string) => haystack.includes(token))
            })
            .slice(0, 25)
          lines.push(`匹配工具（${matches.length}）：`)
          for (const schema of matches) {
            const desc = (schema.description || '').split('\n')[0].slice(0, 80)
            lines.push(`- ${schema.name}: ${desc}${(schema.description || '').startsWith('[危险操作') ? ' [危险]' : ''}`)
          }
          lines.push('解锁：ce_tool_search({"toolNames": ["<精确名称>"]})')
        }

        if (query.length === 0 && unlock.length === 0) {
          lines.push('当前常驻：ce_status、ce_connect。需要其他 ce_* 工具时，用 query 搜索，再用 toolNames 解锁。')
          lines.push('危险工具（写内存/断点/脚本）需显式解锁。')
        }

        return { text: lines.join('\n'), unlocked: unlock }
      },
    })
  }

  return defineTool({
    name: def.name,
    description,
    parameters: def.parameters || {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: any) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args: any) {
      try {
        if (def.execute) {
          const res = withErrorClass(await def.execute(args, client))
          updateSession(def.name, args, res)
          recordAutoEvidence(def.name, args, res)
          if (def.dangerous && res && res.success !== false) session.audit.push({ tool: def.name, args, ts: Date.now() })
          return res
        }
        const params = def.mapParams ? def.mapParams(args) : args
        const raw = await client.sendCommand(def.method, params)
        const mapped = def.mapResult ? def.mapResult(raw, args) : raw
        const wrapped = withErrorClass(mapped)
        updateSession(def.name, args, wrapped)
        recordAutoEvidence(def.name, args, wrapped)
        if (def.dangerous && wrapped && wrapped.success !== false) session.audit.push({ tool: def.name, args, ts: Date.now() })
        return wrapped
      } catch (err: any) {
        return {
          success: false,
          error: String((err && err.message) || err),
          error_class: classifyError(err),
        }
      }
    },
  })
}

function registerTools(ctx: Context, client: CEClient): Array<() => void> {
  return createToolDefs(client).map((def) => ctx.tools.register(buildTool(ctx, client, def)))
}

/**
 * Derive the session's unlocked ce_* tools from durable tool/call events.
 * Matches the official anchored-standard pattern: the agent calls
 * ce_tool_search with toolNames, and the tool/call event persists the
 * unlock request for resume/reload.
 */
function unlockedFromEvents(session: any): Set<string> {
  const unlocked = new Set<string>()
  if (!session || !Array.isArray(session.events)) return unlocked
  for (const event of session.events) {
    if (event.type !== 'tool/call') continue
    if (event.data?.name !== 'ce_tool_search') continue
    let args: any
    try {
      args = JSON.parse(event.data.arguments)
    } catch {
      continue
    }
    if (args && typeof args === 'object' && !Array.isArray(args) && Array.isArray(args.toolNames)) {
      for (const name of args.toolNames) {
        if (typeof name === 'string' && name.length > 0) unlocked.add(name)
      }
    }
  }
  return unlocked
}

const PLAYBOOK_SKILL_CANDIDATE: SkillCandidate = {
  name: 'ce-playbook',
  description: 'Cheat Engine debugging methodology playbook: find_value, find_base, lock_value, verify_address',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-cheatengine',
  source: 'bundled',
  resourceBase: { kind: 'opaque', description: 'ce-playbook inline methodology' },
  rank: 0,
  locator: new URL('memory://ce-playbook'),
}

const cePlaybookProvider: SkillProvider = {
  name: 'dsh-cheatengine',
  list: async () => [PLAYBOOK_SKILL_CANDIDATE],
  get: async () => ({
    name: 'ce-playbook',
    description: PLAYBOOK_SKILL_CANDIDATE.description,
    invocation: PLAYBOOK_SKILL_CANDIDATE.invocation,
    provider: PLAYBOOK_SKILL_CANDIDATE.provider,
    source: PLAYBOOK_SKILL_CANDIDATE.source,
    resourceBase: PLAYBOOK_SKILL_CANDIDATE.resourceBase,
    content: [
      '# ce-playbook',
      '',
      'Cheat Engine 动态调试方法论（建议而非强制，Agent 可自由组合工具）。',
      '',
      '## find_value',
      '1. ce_scan 初扫当前值；候选过多则尝试 float/double/word/qword。',
      '2. ce_next_scan 过滤变化；候选为 1 进入验证。',
      '3. ce_write_integer 写入测试；不生效则 ce_find_what_writes。',
      '4. 需要稳定地址再做 ce_pointer_scan。',
      '',
      '## find_base',
      '1. 先拿到动态地址（ce_scan/ce_find_what_writes）。',
      '2. ce_pointer_scan 向上找指针链。',
      '3. ce_read_pointer_chain 验证链。',
      '',
      '## lock_value',
      '1. ce_read_integer 确认地址。',
      '2. ce_lock_address 锁定目标值。',
      '3. ce_read_integer 验证。',
      '',
      '## verify_address',
      '1. ce_read_integer 读取。',
      '2. ce_write_integer 写入测试。',
      '3. 没变化则 ce_find_what_writes 找写入者。',
      '## 返回值与上限',
      '- ce_scan 只返回 count，具体地址用 ce_get_scan_results。',
      '- ce_get_scan_results / ce_aob_scan / ce_search_string 返回地址列表，有 limit 上限。',
      '- ce_read_memory 返回原始字节，size 上限 4096，可分块读取。',
      '- ce_disassemble count 上限 200。',
      '- ce_pointer_scan max_results 默认 20。',
    ].join('\n'),
  }),
}
function buildStats(): any {
  return {
    phase: session.phase,
    call_count: session.calls.length,
    scan_count: session.scanCount,
    locked_addresses: Array.from(session.locks),
    cache_size: session.cache.size,
    evidence_count: session.evidence.length,
    hypothesis_count: session.hypotheses.length,
    audit_count: session.audit.length,
    summary: session.summary,
    elapsed_seconds: Math.round((Date.now() - session.startTime) / 1000),
    recent_calls: session.calls.slice(-10).reverse().map((c: any) => ({ tool: c.tool, ok: c.ok })),
  }
}

function renderStatusHtml(): string {
  const s = buildStats()
  const lockList = s.locked_addresses.map((a: string) => `<li><code>${a}</code></li>`).join('') || '<li>none</li>'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>DSH Cheat Engine Status</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:2rem;max-width:720px}
h1{font-size:1.4rem}
.card{background:#1c1c1c;border:1px solid #333;border-radius:10px;padding:1rem;margin:1rem 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.k{color:#999;font-size:.8rem;text-transform:uppercase}
.v{font-size:1.1rem;font-weight:600}
ul{padding-left:1.2rem}
li{margin:.2rem 0}
</style>
</head>
<body>
<h1>🧊 DSH Cheat Engine Status</h1>
<div class="card"><div class="grid">
<div><div class="k">Phase</div><div class="v">${s.phase}</div></div>
<div><div class="k">Calls</div><div class="v">${s.call_count}</div></div>
<div><div class="k">Scan count</div><div class="v">${s.scan_count}</div></div>
<div><div class="k">Elapsed</div><div class="v">${s.elapsed_seconds}s</div></div>
<div><div class="k">Evidence</div><div class="v">${s.evidence_count}</div></div>
<div><div class="k">Hypotheses</div><div class="v">${s.hypothesis_count}</div></div>
</div></div>
<div class="card"><h2>Locked</h2><ul>${lockList}</ul></div>
<div class="card"><h2>Recent calls</h2><ul>${s.recent_calls.map((c: any) => `<li>${c.ok ? '✅' : '❌'} ${c.tool}</li>`).join('') || '<li>none</li>'}</ul></div>
<script>setTimeout(()=>location.reload(), 2000)</script>
</body>
</html>`
}
function panelScript(): string {
  return `(function(){
  var PANEL_ID='dsh-ce-status-panel';
  var STYLE_ID='dsh-ce-status-panel-style';
  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent='#dsh-ce-status-panel{position:fixed;right:16px;bottom:16px;z-index:99999;width:260px;background:var(--dsw-alias-bg-layer-3, #1c1c1c);color:var(--dsw-alias-label-primary, #eee);border:1px solid var(--dsw-alias-border-l2, #333);border-radius:12px;padding:12px 14px;font:12px/1.5 var(--ds-font-family-ui, system-ui);box-shadow:var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4));backdrop-filter:blur(6px)}' +
      '#dsh-ce-status-panel h3{margin:0 0 8px;font-size:13px;color:var(--dsw-alias-label-primary, #eee)}' +
      '#dsh-ce-status-panel .row{display:flex;justify-content:space-between;padding:2px 0;color:var(--dsw-alias-label-secondary, #ccc)}' +
      '#dsh-ce-status-panel .sum{margin-top:6px;color:var(--dsw-alias-label-tertiary, #999);white-space:pre-wrap}' +
      '#dsh-ce-status-panel .close{position:absolute;top:6px;right:10px;cursor:pointer;color:var(--dsw-alias-label-tertiary, #999)}';
    document.head.appendChild(s);
  }
  function ensurePanel(){
    var el=document.getElementById(PANEL_ID);
    if(el) return el;
    ensureStyle();
    el=document.createElement('div');
    el.id=PANEL_ID;
    el.innerHTML='<span class="close" onclick="this.parentNode.remove()">×</span>' +
      '<h3>🧊 CE Status</h3>' +
      '<div class="row"><span>Phase</span><b data-field="phase">-</b></div>' +
      '<div class="row"><span>Calls</span><b data-field="calls">-</b></div>' +
      '<div class="row"><span>Scan</span><b data-field="scan">-</b></div>' +
      '<div class="row"><span>Locks</span><b data-field="locks">-</b></div>' +
      '<div class="sum" data-field="summary"></div>';
    document.body.appendChild(el);
    return el;
  }
  function render(d){
    var el=ensurePanel();
    el.querySelector('[data-field=phase]').textContent=d.phase||'-';
    el.querySelector('[data-field=calls]').textContent=d.call_count;
    el.querySelector('[data-field=scan]').textContent=d.scan_count;
    el.querySelector('[data-field=locks]').textContent=d.locked_addresses?d.locked_addresses.length:0;
    el.querySelector('[data-field=summary]').textContent=d.summary||'';
  }
  function tick(){
    fetch('/ce-status/api').then(function(r){return r.json()}).then(render).catch(function(){});
  }
  if(window.MutationObserver){
    new MutationObserver(function(){ if(!document.getElementById(PANEL_ID)) ensurePanel(); }).observe(document.body,{childList:true});
  }
  tick(); setInterval(tick,2000);
})();`
}

function injectStatusPanel(html: string): string {
  if (html.includes('/ce-status-panel.js')) return html
  return html.replace('</body>', '<script src="/ce-status-panel.js"></script></body>')
}
export function apply(ctx: Context, config: Config): void {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const client = new CEClient({
    host: cfg.host,
    port: cfg.port,
    timeoutMs: cfg.timeoutMs,
  })

  ctx.effect(() => {
    const cleanups = registerTools(ctx, client)
    ctx.skills.registerProvider(() => cePlaybookProvider)

    // Web status page (optional; only when webServer is present)
    const webDisposers: Array<() => void> = []
    const webServer = (ctx as any).webServer
    if (webServer && typeof webServer.register === 'function') {
      try {
        webDisposers.push(webServer.register({ kind: 'exact', path: '/ce-status', handler: async (_req: any, res: any) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderStatusHtml()) } }))
        webDisposers.push(webServer.register({ kind: 'exact', path: '/ce-status/api', handler: async (_req: any, res: any) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(buildStats())) } }))
      } catch (err: any) {
        try { ctx.logger.warn(`dsh-cheatengine: failed to register /ce-status routes: ${String((err && err.message) || err)}`) } catch { /* ignore */ }
      }
    }

    // Progressive disclosure: keep only resident + unlocked ce_* tools in the
    // model-facing catalog. Non-ce tools are untouched.
    const disposeFilter = ctx.on('system-prompt/assemble', async (_assembly: any, context: any, next: () => Promise<any>) => {
      const assembled = await next()
      try {
        if (!assembled || !Array.isArray(assembled.tools)) return assembled
        const unlocked = unlockedFromEvents(context?.agent?.session)
        const keep = new Set([...RESIDENT_TOOLS, ...unlocked])
        return {
          ...assembled,
          tools: assembled.tools.filter((tool: any) => !tool.name.startsWith('ce_') || keep.has(tool.name)),
        }
      } catch (err: any) {
        // A filter bug must never break a session: fall back to full catalog.
        try {
          ctx.logger.warn(`dsh-cheatengine: assemble filter failed, exposing full ce_* catalog: ${String((err && err.message) || err)}`)
        } catch { /* ignore */ }
        return assembled
      }
    })

    return () => {
      disposeFilter()
      for (const dispose of webDisposers) dispose()
      for (const dispose of cleanups) dispose()
      client.close()
    }
  }, '@dsh-external/dsh-cheatengine: tools + progressive disclosure')
}
