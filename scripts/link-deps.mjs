#!/usr/bin/env node
/**
 * Link DSH runtime peer dependencies into this plugin's node_modules.
 *
 * The plugin is normally loaded from an external path, so Node cannot resolve
 * `@deepseek-ai/dsh-tools` from the plugin directory. This script creates a
 * directory junction/symlink from `node_modules/@deepseek-ai/dsh-tools` to the
 * actual package inside the DSH runtime installation.
 *
 * Usage:
 *   node scripts/link-deps.mjs
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function resolveDshTools() {
  const home = process.env.DSH_HOME
  const candidates = [
    // Global npm install of @deepseek-ai/dsh (common on Windows)
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools'),
    // Some setups place the runtime under DSH_HOME
    home && join(home, '..', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools'),
    // Fallback: search common locations
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh-tools'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

const target = resolveDshTools()
if (!target) {
  console.error('[link-deps] Could not locate @deepseek-ai/dsh-tools. Set DSH_HOME or install DSH globally.')
  process.exit(1)
}

const scopedDir = join(root, 'node_modules', '@deepseek-ai')
const link = join(scopedDir, 'dsh-tools')
mkdirSync(scopedDir, { recursive: true })
if (existsSync(link)) {
  rmSync(link, { recursive: true, force: true })
}
try {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`[link-deps] Linked ${target} -> ${link}`)
} catch (err) {
  console.error(`[link-deps] Failed to link: ${err.message}`)
  process.exit(1)
}
