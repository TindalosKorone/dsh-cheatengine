/**
 * @tindalosko/dsh-cheatengine — Cheat Engine bridge toolkit.
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
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { CEClient } from './ce-client.js'
import { updateSession, pushAudit, pushEvidence, type SessionState } from './session.js'
import { cePlaybookProvider } from './playbook.js'
import { buildStats, renderStatusHtml } from './web.js'
import { session, getSession, setSession } from './state.js'
import { createToolDefs, type ToolDef } from './tools/index.js'
import { RESIDENT_TOOLS, TOOL_PACKS, COMPAT_TOOLS, isOwnTool } from './tools/constants.js'

export { createToolDefs } from './tools/index.js'

export const name = '@tindalosko/dsh-cheatengine'
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

function recordAutoEvidence(s: SessionState, toolName: string, args: any, result: any): void {
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
  } else if (toolName === 'ce_memory_write') {
    const mode = args.mode || 'integer'
    const target = mode === 'many' ? `${Array.isArray(args.addresses) ? args.addresses.length : 0} addresses` : String(args.address || '')
    entry = { claim: `write ${target}`, method: 'ce_memory_write', result: `mode=${mode}`, tags: ['write'] }
  } else if (toolName === 'ce_lock_address') {
    entry = { claim: `lock ${args.address}`, method: 'ce_lock_address', result: `value=${args.value}`, tags: ['lock'] }
  } else if (toolName === 'ce_pointer_scan') {
    entry = { claim: `pointer scan ${args.address}`, method: 'ce_pointer_scan', result: `chains=${result.count}`, tags: ['pointer'] }
  } else if (toolName === 'ce_detect_protection') {
    entry = { claim: 'protection scan', method: 'ce_detect_protection', result: `risk=${result.risk}`, tags: ['protection'] }
  }
  if (entry) {
    entry.id = `E${s.evidence.length + 1}`
    entry.ts = Date.now()
    pushEvidence(s, entry)
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
        const packs: string[] = Array.isArray(args.packs)
          ? args.packs.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
          : []
        const lines: string[] = []
        let schemas: any[] = []
        try {
          schemas = ctx.tools.schemas(exec?.agent) || []
        } catch (err: any) {
          lines.push(`目录搜索不可用：${String((err && err.message) || err)}`)
        }
        const allOwnSchemas = schemas.filter((schema) => isOwnTool(schema.name))
        const primarySchemas = allOwnSchemas.filter((schema) => !COMPAT_TOOLS.has(schema.name))

        const packTools = packs.flatMap((pack) => TOOL_PACKS[pack] || [])
        const unlockNames = Array.from(new Set([...unlock, ...packTools]))

        if (unlockNames.length > 0) {
          const valid = allOwnSchemas.filter((schema) => unlockNames.includes(schema.name))
          const invalid = unlockNames.filter((name: string) => !allOwnSchemas.some((schema) => schema.name === name))
          if (packs.length > 0) {
            lines.push(`任务包：${packs.join(', ')} → ${valid.filter((s) => !COMPAT_TOOLS.has(s.name)).map((schema) => schema.name).join(', ') || '(无)'}`)
          }
          lines.push(`将在下一请求解锁：${valid.map((schema) => schema.name).join(', ') || '(无)'}`)
          if (invalid.length > 0) lines.push(`未找到：${invalid.join(', ')}`)
          const dangerous = valid.filter((schema) => (schema.description || '').startsWith('[危险操作'))
          if (dangerous.length > 0) {
            lines.push(`注意：以下为危险工具，请谨慎使用：${dangerous.map((schema) => schema.name).join(', ')}`)
          }
        }

        if (query.length > 0) {
          const tokens = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)
          const matches = primarySchemas
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
          lines.push('解锁：ce_tool_search({"toolNames": ["<精确名称>"]}) 或 ce_tool_search({"packs": ["scan"]})')
        }

        if (query.length === 0 && unlockNames.length === 0) {
          lines.push('当前常驻：ce_status、ce_connect、ce_tool_search、ce_playbook、ce_mission。')
          lines.push('可用任务包：process / scan / memory / debug / lock / analyze / case / script / guide / all')
          lines.push('旧版 ce_read_* / ce_write_* / ce_session_stats 等仍可用 toolNames 精确解锁（兼容）。')
          lines.push('示例：ce_tool_search({"packs": ["scan", "memory"]})')
          lines.push('危险工具（写内存/断点/脚本）需显式解锁。')
        }

        return { text: lines.join('\n'), unlocked: unlockNames, packs }
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
    async execute(args: any, exec: any) {
      const s = getSession(exec)
      // Point the module-level session at this agent's session for the duration
      // of the call. We intentionally do NOT restore the previous value: the web
      // panel should keep showing the most recently active session.
      setSession(s)
      try {
        if (def.execute) {
          const res = withErrorClass(await def.execute(args, client))
          updateSession(s, def.name, args, res)
          recordAutoEvidence(s, def.name, args, res)
          if (def.dangerous && res && res.success !== false) pushAudit(s, { tool: def.name, args, ts: Date.now() })
          return res
        }
        const params = def.mapParams ? def.mapParams(args) : args
        const raw = await client.sendCommand(def.method, params)
        const mapped = def.mapResult ? def.mapResult(raw, args) : raw
        const wrapped = withErrorClass(mapped)
        updateSession(s, def.name, args, wrapped)
        recordAutoEvidence(s, def.name, args, wrapped)
        if (def.dangerous && wrapped && wrapped.success !== false) pushAudit(s, { tool: def.name, args, ts: Date.now() })
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
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      if (Array.isArray(args.toolNames)) {
        for (const name of args.toolNames) {
          if (typeof name === 'string' && name.length > 0) unlocked.add(name)
        }
      }
      if (Array.isArray(args.packs)) {
        for (const pack of args.packs) {
          if (typeof pack !== 'string') continue
          for (const name of TOOL_PACKS[pack] || []) unlocked.add(name)
        }
      }
    }
  }
  return unlocked
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
        webDisposers.push(webServer.register({ kind: 'exact', path: '/ce-status', handler: async (_req: any, res: any) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderStatusHtml(session)) } }))
        webDisposers.push(webServer.register({ kind: 'exact', path: '/ce-status/api', handler: async (_req: any, res: any) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(buildStats(session))) } }))
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
          tools: assembled.tools.filter((tool: any) => !isOwnTool(tool.name) || keep.has(tool.name)),
        }
      } catch (err: any) {
        // Fail closed: if the filter itself breaks, never leak the full catalog.
        try {
          ctx.logger.warn(`dsh-cheatengine: assemble filter failed, keeping resident tools only: ${String((err && err.message) || err)}`)
        } catch { /* ignore */ }
        return {
          ...assembled,
          tools: assembled.tools.filter((tool: any) => !isOwnTool(tool.name) || RESIDENT_TOOLS.has(tool.name)),
        }
      }
    })

    return () => {
      disposeFilter()
      for (const dispose of webDisposers) dispose()
      for (const dispose of cleanups) dispose()
      client.close()
    }
  }, '@tindalosko/dsh-cheatengine: tools + progressive disclosure')
}
