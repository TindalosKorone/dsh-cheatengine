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
  'ce_find_what_writes',
  'ce_lock_address',
  'ce_unlock_address',
  'ce_pointer_scan',
  'ce_detect_engine',
  'ce_session_stats',
  'ce_budget_status',
  'ce_cache_status',
  'ce_forget',
  'ce_hypothesis',
  'ce_evidence',
  'ce_playbook',
  'ce_audit_log',
  'ce_undo_last',
  'ce_snapshot_save',
  'ce_snapshot_load',
  'ce_risk_levels',
  'install_ce_bridge',
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
