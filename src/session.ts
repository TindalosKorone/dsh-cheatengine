/**
 * Session state for dsh-cheatengine.
 *
 * Centralizes the per-debug-session state machine, capacity caps, and the L0
 * automatic one-line summary + capped recent events.
 */
export interface SessionState {
  phase: string
  startTime: number
  calls: any[]
  scanCount: number
  cache: Map<string, any>
  locks: Set<string>
  audit: any[]
  hypotheses: any[]
  undoStack: any[]
  summary: string
  evidence: any[]
  recentEvents: any[]
}

export function createSessionState(): SessionState {
  return {
    phase: 'idle',
    startTime: Date.now(),
    calls: [],
    scanCount: 0,
    cache: new Map(),
    locks: new Set(),
    audit: [],
    hypotheses: [],
    undoStack: [],
    summary: '',
    evidence: [],
    recentEvents: [],
  }
}

/** Capacity caps for unbounded session collections. */
export const MAX_UNDO = 100
export const MAX_EVIDENCE = 200
export const MAX_HYPOTHESES = 100
export const MAX_AUDIT = 200
export const MAX_RECENT_EVENTS = 5
export const MAX_CALLS = 200

export function pushCapped<T>(arr: T[], item: T, cap: number): void {
  arr.push(item)
  if (arr.length > cap) arr.shift()
}

export function pushUndo(s: SessionState, item: any): void { pushCapped(s.undoStack, item, MAX_UNDO) }
export function pushEvidence(s: SessionState, item: any): void { pushCapped(s.evidence, item, MAX_EVIDENCE) }
export function pushHypothesis(s: SessionState, item: any): void { pushCapped(s.hypotheses, item, MAX_HYPOTHESES) }
export function pushAudit(s: SessionState, item: any): void { pushCapped(s.audit, item, MAX_AUDIT) }

export function pushRecentEvent(s: SessionState, text: string): void {
  s.recentEvents.push({ text, ts: Date.now() })
  if (s.recentEvents.length > MAX_RECENT_EVENTS) s.recentEvents.shift()
}

export function updateSession(s: SessionState, toolName: string, args: any, result: any): void {
  s.calls.push({
    tool: toolName,
    ts: Date.now(),
    ok: !(result && result.success === false),
    error_class: result && result.error_class,
  })
  if (s.calls.length > MAX_CALLS) s.calls.shift()

  if (toolName === 'ce_scan' && result && result.success !== false) {
    s.phase = 'scanning'
    s.scanCount = Number(result.count) || 0
    s.cache.set(String(args.value), { type: args.type || 'dword', count: s.scanCount, ts: Date.now() })
  } else if (toolName === 'ce_next_scan' && result && result.success !== false) {
    s.phase = 'filtering'
    s.scanCount = Number(result.count) || 0
  } else if (toolName === 'ce_scan_many' && result && result.success !== false && Array.isArray(result.results) && result.results.length > 0) {
    const last = result.results[result.results.length - 1]
    s.phase = 'scanning'
    s.scanCount = Number(last?.count) || 0
    const lastValue = Array.isArray(args.values) ? String(args.values[args.values.length - 1]) : ''
    s.cache.set(lastValue, { type: args.type || 'dword', count: s.scanCount, ts: Date.now() })
  } else if (toolName === 'ce_find_what_writes' && result && result.success !== false) {
    s.phase = 'tracing'
  } else if (toolName === 'ce_pointer_scan' && result && result.success !== false) {
    s.phase = 'verifying'
  } else if (toolName === 'ce_lock_address' && result && result.success !== false) {
    s.phase = 'locked'
    s.locks.add(String(args.address))
  } else if (toolName === 'ce_unlock_address' && result && result.success !== false) {
    s.locks.delete(String(args.address))
  }

  // L0: automatic one-line summary + capped recent events
  const ok = !(result && result.success === false)
  if (!ok) {
    s.summary = `最近操作失败：${String(result?.error || 'unknown')}`
    pushRecentEvent(s, `失败 ${toolName}: ${String(result?.error || 'unknown')}`)
    return
  }

  let summary = ''
  let event = ''
  if (toolName === 'ce_scan') {
    summary = `候选 ${result.count}`
    event = `扫描 ${args.value} → ${result.count} 候选`
  } else if (toolName === 'ce_next_scan') {
    summary = `候选 ${result.count}`
    event = `过滤 ${args.value} → ${result.count} 候选`
  } else if (toolName === 'ce_scan_many') {
    const last = Array.isArray(result.results) ? result.results[result.results.length - 1] : null
    summary = `候选 ${last?.count ?? 0}`
    event = `批量扫描完成，最后候选 ${last?.count ?? 0}`
  } else if (toolName === 'ce_get_scan_results') {
    summary = `候选 ${result.total ?? result.returned ?? 0}`
    event = `读取扫描结果 ${result.returned ?? 0} 条`
  } else if (toolName === 'ce_write_integer') {
    summary = `已写入 ${args.address} = ${args.value}`
    event = `写入 ${args.address} = ${args.value}`
  } else if (toolName === 'ce_memory_write') {
    const mode = args.mode || 'integer'
    const target = mode === 'many' ? `${Array.isArray(args.addresses) ? args.addresses.length : 0} 个地址` : String(args.address || '')
    summary = `已写入 ${target}`
    event = `内存写入 ${target}（${mode}）`
  } else if (toolName === 'ce_lock_address') {
    summary = `已锁定 ${args.address}`
    event = `锁定 ${args.address} = ${args.value}`
  } else if (toolName === 'ce_unlock_address') {
    summary = `已解锁 ${args.address}`
    event = `解锁 ${args.address}`
  } else if (toolName === 'ce_find_what_writes') {
    const hit = result?.hit
    summary = `找到写入者 ${hit?.instruction || hit?.registers?.RIP || ''}`
    event = `找写入者 ${args.address}`
  } else if (toolName === 'ce_pointer_scan') {
    summary = `指针扫描 ${result.count} 条链`
    event = `指针扫描 ${args.address} → ${result.count} 条链`
  } else if (toolName === 'ce_detect_protection') {
    summary = `保护检测：${result.risk}`
    event = `保护检测 → ${result.risk}`
  } else if (toolName === 'ce_attach') {
    summary = `已附加 ${args.process_id_or_name}`
    event = `附加 ${args.process_id_or_name}`
  } else if (toolName === 'ce_connect') {
    summary = '已连接 CE 桥接'
    event = '连接 CE 桥接'
  }
  if (summary) s.summary = summary
  if (event) pushRecentEvent(s, event)
}
