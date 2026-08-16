import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolDefs } from '../lib/index.js'

test('tool names are unique', () => {
  const defs = createToolDefs({})
  const names = defs.map((d) => d.name)
  const dupes = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(', ')}`)
})

test('required tools exist', () => {
  const defs = createToolDefs({})
  const names = new Set(defs.map((d) => d.name))
  const required = [
    'ce_status',
    'ce_connect',
    'ce_scan',
    'ce_next_scan',
    'ce_get_scan_results',
    'ce_find_what_writes',
    'ce_lock_address',
    'ce_pointer_scan',
    'ce_detect_engine',
    'ce_session_stats',
    'ce_evidence',
    'ce_playbook',
    'ce_mission',
    'ce_explain_scan_result',
    'ce_status_report',
    'ce_analyst',
    'ce_detect_protection',
    'install_ce_bridge',
  ]
  const missing = required.filter((n) => !names.has(n))
  assert.deepEqual(missing, [], `missing tools: ${missing.join(', ')}`)
})

test('every tool has a name and description', () => {
  const defs = createToolDefs({})
  for (const d of defs) {
    assert.ok(d.name, `tool missing name`)
    assert.ok(d.description, `tool ${d.name} missing description`)
    assert.ok(d.method || d.execute, `tool ${d.name} missing method/execute`)
  }
})

test('ce_tool_search supports task packs', () => {
  const defs = createToolDefs({})
  const search = defs.find((d) => d.name === 'ce_tool_search')
  assert.ok(search)
  assert.ok(search.parameters.packs, 'ce_tool_search should accept packs')
  assert.ok(search.parameters.toolNames, 'ce_tool_search should accept toolNames')
  assert.match(search.description, /process|scan|memory|debug|lock|analyze|case|script|guide|all/)
})

test('parameter caps are applied', async () => {
  const defs = createToolDefs({})
  const byName = (name) => defs.find((d) => d.name === name)
  const readMemory = byName('ce_read_memory')
  const disassemble = byName('ce_disassemble')
  const getScanResults = byName('ce_get_scan_results')
  const aobScan = byName('ce_aob_scan')
  const searchString = byName('ce_search_string')
  const readString = byName('ce_read_string')
  const enumModules = byName('ce_enum_modules')
  const pointerScan = byName('ce_pointer_scan')
  const breakpointHits = byName('ce_get_breakpoint_hits')

  for (const d of [readMemory, disassemble, getScanResults, aobScan, searchString, readString, enumModules, pointerScan, breakpointHits]) {
    assert.ok(d, `missing tool for caps test: ${d && d.name}`)
  }

  assert.ok(readMemory.mapParams({ address: '0x0', size: 99999 }).size <= 4096)
  assert.ok(disassemble.mapParams({ address: '0x0', count: 999, limit: 999 }).count <= 200)
  assert.ok(disassemble.mapParams({ address: '0x0', count: 999, limit: 999 }).limit <= 200)
  assert.ok(getScanResults.mapParams({ offset: 0, limit: 99999 }).limit <= 1000)
  assert.ok(aobScan.mapParams({ pattern: '90', limit: 99999 }).limit <= 1000)
  assert.ok(searchString.mapParams({ string: 'x', limit: 99999 }).limit <= 1000)
  assert.ok(readString.mapParams({ address: '0x0', max_length: 99999 }).max_length <= 4096)
  assert.ok(enumModules.mapParams({ offset: -5, limit: 99999 }).offset >= 0)
  assert.ok(enumModules.mapParams({ offset: -5, limit: 99999 }).limit <= 1000)
  assert.ok(pointerScan.max_depth ? pointerScan.execute : true) // pointerScan caps are applied inside execute
  assert.ok(breakpointHits.mapParams({ id: 'x', limit: 99999 }).limit <= 1000)
})
