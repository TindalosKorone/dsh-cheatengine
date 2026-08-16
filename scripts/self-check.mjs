#!/usr/bin/env node
/**
 * Local self-check for @dsh-external/dsh-cheatengine.
 *
 * Verifies:
 *   - lib build exists
 *   - lib passes node --check
 *   - key tools are present in lib
 *   - runtime dependency link (@deepseek-ai/dsh-tools) exists
 *
 * Usage:
 *   node scripts/self-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const lib = join(root, 'lib', 'index.js')

const requiredTools = [
  'ce_status',
  'ce_connect',
  'ce_list_processes',
  'ce_attach',
  'ce_process_info',
  'ce_enum_modules',
  'ce_scan',
  'ce_next_scan',
  'ce_get_scan_results',
  'ce_aob_scan',
  'ce_search_string',
  'ce_read_memory',
  'ce_read_integer',
  'ce_read_string',
  'ce_read_pointer_chain',
  'ce_write_integer',
  'ce_write_memory',
  'ce_write_string',
  'ce_disassemble',
  'ce_get_instruction_info',
  'ce_set_breakpoint',
  'ce_set_data_breakpoint',
  'ce_list_breakpoints',
  'ce_remove_breakpoint',
  'ce_get_breakpoint_hits',
  'ce_clear_breakpoints',
  'ce_get_registers',
  'ce_execute_lua',
  'ce_auto_assemble',
  'ce_find_what_writes',
  'ce_lock_address',
  'ce_unlock_address',
  'ce_pointer_scan',
  'ce_detect_engine',
  'install_ce_bridge',
  'ce_session_stats',
  'ce_cache_status',
  'ce_forget',
  'ce_scan_many',
  'ce_read_many',
  'ce_write_many',
  'ce_budget_status',
  'ce_audit_log',
  'ce_snapshot_save',
  'ce_snapshot_load',
  'ce_risk_levels',
  'ce_hypothesis',
  'ce_undo_last',
  'ce_playbook',
  'ce_evidence',
  'ce_cheat_table_save',
  'ce_cheat_table_load',
  'ce_speedhack',
  'ce_dump_module',
  'ce_aob_generate',
  'ce_detect_protection',
  'ce_mission',
  'ce_explain_scan_result',
  'ce_status_report',
  'ce_analyst',
  'ce_tool_search',
]

let failed = false

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

// 1. lib exists
check('lib/index.js exists', existsSync(lib), lib)

// 2. node --check
if (existsSync(lib)) {
  const res = spawnSync(process.execPath, ['--check', lib], { encoding: 'utf8' })
  check('lib/index.js syntax', res.status === 0, res.stderr?.trim() || '')
}

// 3. key tools present
if (existsSync(lib)) {
  const src = readFileSync(lib, 'utf8')
  for (const tool of requiredTools) {
    check(`tool ${tool}`, src.includes(`name: '${tool}'`))
  }
}

// 4. dependency link (local dev only; CI has no DSH runtime installed)
const isCI = !!process.env.CI
const depLink = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
if (isCI) {
  console.log('SKIP  dsh-tools link (CI)')
} else {
  check('dsh-tools link exists', existsSync(depLink), depLink)
}

// 5. bundle manifest
const patch = join(root, 'cordis.patch.yml')
check('cordis.patch.yml exists', existsSync(patch), patch)

console.log(failed ? '\nSELF-CHECK FAILED' : '\nSELF-CHECK PASSED')
process.exit(failed ? 1 : 0)
