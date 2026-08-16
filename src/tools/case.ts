import { pushEvidence, pushHypothesis } from '../session.js'
import { session, snapshot, setSnapshot } from '../state.js'
import type { ToolDef } from './types.js'

export const caseStatsDefs: ToolDef[] = [
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
    parameters: {
      limit: { type: 'integer', description: '返回条数，默认 100' },
    },
    async execute(args: any) {
      const entries: any[] = []
      session.cache.forEach((v: any, k: string) => entries.push({ key: k, ...v }))
      const limit = Math.min(Number(args.limit) || 100, 1000)
      return { success: true, cache_size: entries.length, entries: entries.slice(0, limit), returned: Math.min(entries.length, limit) }
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
]

export const caseBudgetDefs: ToolDef[] = [
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
      setSnapshot({
        phase: session.phase,
        scanCount: session.scanCount,
        locks: Array.from(session.locks),
        cache: Array.from(session.cache.entries()),
        ts: Date.now(),
      })
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
        const statement = String(args.statement || '').trim()
        if (!statement) return { success: false, error: 'statement is required for add', error_class: 'INVALID_ARGS' }
        const id = args.id || `H${session.hypotheses.length + 1}`
        pushHypothesis(session, { id, statement, result: args.result || null, ts: Date.now() })
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
      const idx = session.undoStack.length - 1
      const last = session.undoStack[idx]
      if (!last) return { success: false, error: 'no dangerous operation to undo', error_class: 'NOTHING_TO_UNDO' }
      if (last.kind === 'lock' && last.address) {
        const addr = String(last.address)
        const addrNum = Number.parseInt(addr.replace(/^0x/i, ''), 16)
        if (!Number.isFinite(addrNum)) return { success: false, error: 'cannot undo lock: invalid address', error_class: 'INVALID_ADDRESS' }
        const res = await client.sendCommand('evaluate_lua', {
          code: [
            `local addr = ${addrNum}`,
            `if _G.__mcp_locks and _G.__mcp_locks[addr] then _G.__mcp_locks[addr].destroy(); _G.__mcp_locks[addr] = nil end`,
            `return "unlocked"`,
          ].join('\n'),
        })
        if (!res || res.success === false) {
          return { success: false, error: (res && res.error) || 'undo lock failed', error_class: 'BRIDGE_UNAVAILABLE' }
        }
        session.undoStack.pop()
        session.locks.delete(addr)
        return { success: true, undone: 'ce_lock_address', address: addr }
      }
      if (last.kind === 'write' && last.address) {
        if (last.before === null || last.before === undefined) {
          return { success: false, error: 'cannot undo write: previous value unknown', error_class: 'UNDO_NOT_SUPPORTED' }
        }
        const res = await client.sendCommand('write_integer', { address: last.address, value: last.before, type: last.type || 'dword' })
        if (!res || res.success === false) {
          return { success: false, error: (res && res.error) || 'undo write failed', error_class: 'BRIDGE_UNAVAILABLE' }
        }
        session.undoStack.pop()
        return { success: true, undone: 'ce_write_integer', address: last.address, restored: last.before }
      }
      if (last.kind === 'write_memory' && last.address) {
        if (!Array.isArray(last.before)) return { success: false, error: 'cannot undo write_memory: previous bytes unknown', error_class: 'UNDO_NOT_SUPPORTED' }
        const res = await client.sendCommand('write_memory', { address: last.address, bytes: last.before })
        if (!res || res.success === false) {
          return { success: false, error: (res && res.error) || 'undo write_memory failed', error_class: 'BRIDGE_UNAVAILABLE' }
        }
        session.undoStack.pop()
        return { success: true, undone: 'ce_write_memory', address: last.address, restored: last.before }
      }
      if (last.kind === 'write_string' && last.address) {
        if (last.before === null || last.before === undefined) return { success: false, error: 'cannot undo write_string: previous string unknown', error_class: 'UNDO_NOT_SUPPORTED' }
        const res = await client.sendCommand('write_string', { address: last.address, value: last.before, wide: !!last.wide })
        if (!res || res.success === false) {
          return { success: false, error: (res && res.error) || 'undo write_string failed', error_class: 'BRIDGE_UNAVAILABLE' }
        }
        session.undoStack.pop()
        return { success: true, undone: 'ce_write_string', address: last.address, restored: last.before }
      }
      return { success: false, error: `cannot undo ${last.kind} automatically`, error_class: 'UNDO_NOT_SUPPORTED' }
    },
  },
]

export const caseEvidenceDefs: ToolDef[] = [
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
        const claim = String(args.claim || '').trim()
        if (!claim) return { success: false, error: 'claim is required for add', error_class: 'INVALID_ARGS' }
        const entry = {
          id: `E${session.evidence.length + 1}`,
          claim,
          method: args.method || '',
          result: args.result || '',
          tags: Array.isArray(args.tags) ? args.tags : [],
          ts: Date.now(),
        }
        pushEvidence(session, entry)
        return { success: true, id: entry.id, count: session.evidence.length }
      }
      return { success: true, count: session.evidence.length, entries: session.evidence.slice(-50).reverse() }
    },
  },
]

export const caseReportDefs: ToolDef[] = [
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
]

export const caseSessionDefs: ToolDef[] = [
  {
    name: 'ce_session',
    description: '统一会话工具：stats/budget/report/analyst',
    method: 'ce_session',
    parameters: {
      action: { type: 'string', description: 'stats|budget|report|analyst，默认 stats' },
    },
    async execute(args: any) {
      const action = args.action || 'stats'
      const elapsedMs = Date.now() - session.startTime
      if (action === 'stats') {
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
      }
      if (action === 'budget') {
        return {
          success: true,
          call_count: session.calls.length,
          elapsed_ms: elapsedMs,
          elapsed_seconds: Math.round(elapsedMs / 1000),
          scan_count: session.scanCount,
          phase: session.phase,
        }
      }
      if (action === 'report') {
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
      }
      if (action === 'analyst') {
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
      }
      return { success: false, error: `unsupported action: ${action}`, error_class: 'INVALID_ARGS' }
    },
  },
]
