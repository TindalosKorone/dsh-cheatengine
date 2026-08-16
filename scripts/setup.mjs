#!/usr/bin/env node
/**
 * One-command local setup for @dsh-external/dsh-cheatengine.
 *
 * Checks the repo is ready to use and creates the runtime dependency link
 * (@deepseek-ai/dsh-tools) when running from a source checkout.
 *
 * Usage:
 *   node scripts/setup.mjs
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function ok(msg) {
  console.log(`[setup] OK   ${msg}`)
}

function warn(msg) {
  console.log(`[setup] WARN ${msg}`)
}

function step(msg) {
  console.log(`[setup] ...  ${msg}`)
}

// 1. Node version
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 18) {
  warn(`Node ${process.versions.node} detected; Node 18+ recommended`)
} else {
  ok(`Node ${process.versions.node}`)
}

// 2. lib exists (prebuilt runtime)
const lib = join(root, 'lib', 'index.js')
if (existsSync(lib)) {
  ok('lib/index.js exists (prebuilt runtime)')
} else {
  warn('lib/index.js missing; run `npm run build` first')
}

// 3. Runtime dependency link
const depLink = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
if (!existsSync(depLink)) {
  step('linking @deepseek-ai/dsh-tools')
  const res = spawnSync(process.execPath, [join(__dirname, 'link-deps.mjs')], { stdio: 'inherit' })
  if (res.status !== 0) {
    console.error('[setup] FAILED to link dependencies')
    process.exit(1)
  }
} else {
  ok('@deepseek-ai/dsh-tools link exists')
}

// 4. Self-check
step('running self-check')
const check = spawnSync(process.execPath, [join(__dirname, 'self-check.mjs')], { stdio: 'inherit' })
if (check.status !== 0) {
  console.error('[setup] self-check failed')
  process.exit(1)
}

console.log('')
console.log('[setup] Done. Next steps:')
console.log('  - If you use DSH:  dsh plugin add github:TindalosKorone/dsh-cheatengine')
console.log('  - Or let the agent run:  dev_inject_plugin {"dir": "/absolute/path/dsh-cheatengine"}')
console.log('  - If you hit "@deepseek-ai/dsh-tools not found", run:  node scripts/setup.mjs')
