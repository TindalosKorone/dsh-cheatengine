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

test('parameter caps are applied', async () => {
  const defs = createToolDefs({})
  const readMemory = defs.find((d) => d.name === 'ce_read_memory')
  const disassemble = defs.find((d) => d.name === 'ce_disassemble')
  assert.ok(readMemory)
  assert.ok(disassemble)
  const mappedRead = readMemory.mapParams({ address: '0x0', size: 99999 })
  assert.ok(mappedRead.size <= 4096)
  const mappedDis = disassemble.mapParams({ address: '0x0', count: 999, limit: 999 })
  assert.ok(mappedDis.count <= 200)
  assert.ok(mappedDis.limit <= 200)
})
