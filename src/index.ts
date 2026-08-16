/**
 * @dsh-external/dsh-cheatengine — Cheat Engine bridge toolkit.
 *
 * Exposes ce_* tools to the DSH agent. The plugin is a thin JSON-RPC client
 * for the Cheat Engine MCP Bridge (ce_mcp_bridge.lua + ce_mcp_tcp DLL):
 *   https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge
 *
 * Deployment (one-time, on the Windows machine running Cheat Engine):
 *   1. Copy ce_mcp_tcp_x64.dll (or x86) into the Cheat Engine directory.
 *   2. Open Cheat Engine, attach to the target process.
 *   3. File → Execute Script → run MCP_Server/ce_mcp_bridge.lua.
 *   4. Bridge listens on TCP 127.0.0.1:17171 by default.
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { CEClient } from './ce-client.js'

export const name = '@dsh-external/dsh-cheatengine'
export const inject = ['tools']

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

interface ToolDef {
  name: string
  description: string
  parameters?: Record<string, any>
  method: string
  mapParams?: (args: any) => Record<string, any>
  dangerous?: boolean
}

function buildTool(client: CEClient, def: ToolDef) {
  const description = def.dangerous
    ? `[危险操作-改内存/调试] ${def.description}`
    : def.description
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
        const params = def.mapParams ? def.mapParams(args) : args
        return await client.sendCommand(def.method, params)
      } catch (err: any) {
        return {
          success: false,
          error: String((err && err.message) || err),
        }
      }
    },
  })
}

function registerTools(ctx: Context, client: CEClient): Array<() => void> {
  const defs: ToolDef[] = [
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
      description: '首次扫描内存：精确数值、字符串或数组；结果通过 ce_get_scan_results 读取',
      method: 'scan_all',
      parameters: {
        value: { type: 'string', required: true, description: '要搜索的值，如 "100"、"hello" 或 "48 89 5C"' },
        type: { type: 'string', description: 'exact|string|array，默认 exact' },
        protection: { type: 'string', description: '内存保护，默认 +W-C' },
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
      description: '获取当前线程寄存器（RAX/RBX/... 或 EAX/EBX/...）',
      method: 'evaluate_lua',
      mapParams: () => ({
        code: [
          'local function h(v) if v == nil then return "nil" end return string.format("%X", v) end',
          'if targetIs64Bit() then',
          '  return string.format("RAX=%s RBX=%s RCX=%s RDX=%s RSI=%s RDI=%s RBP=%s RSP=%s RIP=%s R8=%s R9=%s R10=%s R11=%s R12=%s R13=%s R14=%s R15=%s EFLAGS=%s", h(RAX), h(RBX), h(RCX), h(RDX), h(RSI), h(RDI), h(RBP), h(RSP), h(RIP), h(R8), h(R9), h(R10), h(R11), h(R12), h(R13), h(R14), h(R15), h(EFLAGS))',
          'else',
          '  return string.format("EAX=%s EBX=%s ECX=%s EDX=%s ESI=%s EDI=%s EBP=%s ESP=%s EIP=%s EFLAGS=%s", h(EAX), h(EBX), h(ECX), h(EDX), h(ESI), h(EDI), h(EBP), h(ESP), h(EIP), h(EFLAGS))',
          'end',
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
  ]

  return defs.map((def) => ctx.tools.register(buildTool(client, def)))
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
    return () => {
      for (const dispose of cleanups) dispose()
      client.close()
    }
  }, '@dsh-external/dsh-cheatengine: tools')
}
