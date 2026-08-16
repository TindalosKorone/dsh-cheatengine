#!/usr/bin/env node
/**
 * Cross-platform build script for dsh-cheatengine (Node.js implementation).
 *
 * Why this exists: scripts/build.sh is the bash-based build used by
 * dev_build_plugin inside the container. On a Windows PC where the terminal is
 * PowerShell and bash may not be installed, `npm run build` / `node
 * scripts/build.mjs` provides an equivalent path that only requires Node.js.
 *
 * Behavior mirrors scripts/build.sh:
 *   - If DSH_CHECKOUT (or a common checkout path) is found, link build
 *     dependencies into node_modules and compile src/ → lib/ with tsc.
 *   - If no checkout is found but lib/ already contains runnable JS, skip the
 *     compile and exit 0 (this lets a cloned repo install directly).
 */
import { existsSync, rmSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
process.chdir(ROOT)

function fail(message) {
  console.error(`build: ${message}`)
  process.exit(1)
}

function detectCheckout() {
  const explicit = process.env.DSH_CHECKOUT
  if (explicit && existsSync(join(explicit, 'packages'))) return explicit
  const candidates = [
    join(homedir(), 'dsh-harness'),
    join(homedir(), 'dsh'),
    join(homedir(), '.dsh', 'dsh-harness'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'packages'))) return candidate
  }
  return null
}

function linkPkg(checkout, pkgName, relativeTarget) {
  const target = resolve(checkout, relativeTarget)
  if (!existsSync(target)) {
    fail(`dependency target missing: ${target}`)
  }
  const link = resolve(ROOT, 'node_modules', pkgName)
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  // Windows: use junction for directories; POSIX: use symlink.
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(target, link, type)
}

const checkout = detectCheckout()

if (!checkout) {
  if (existsSync(join(ROOT, 'lib', 'index.js')) && existsSync(join(ROOT, 'lib', 'ce-client.js'))) {
    console.log('build: no DSH checkout found; using prebuilt lib/ (skip compile)')
    process.exit(0)
  }
  fail('cannot locate the dsh checkout (set DSH_CHECKOUT)')
}

// Reuse the same fallback as build.sh: an incomplete checkout is fine when a
// prebuilt lib/ already exists (e.g. the repo ships lib/ for direct install).
const keyDepsOk =
  existsSync(join(checkout, 'vendor', 'cordis')) &&
  existsSync(join(checkout, 'packages', 'core', 'tools'))
if (!keyDepsOk) {
  if (existsSync(join(ROOT, 'lib', 'index.js')) && existsSync(join(ROOT, 'lib', 'ce-client.js'))) {
    console.log('build: checkout incomplete; using prebuilt lib/ (skip compile)')
    process.exit(0)
  }
  fail('checkout incomplete (missing vendor/cordis or packages/core/tools)')
}

console.log(`=== Linking build dependencies (checkout: ${checkout}) ===`)
mkdirSync(join(ROOT, 'node_modules', '@deepseek-ai'), { recursive: true })
rmSync(join(ROOT, 'node_modules', '@standard-schema'), { recursive: true, force: true })

linkPkg(checkout, 'cordis', 'vendor/cordis')
linkPkg(checkout, 'cosmokit', 'vendor/cosmokit')
linkPkg(checkout, 'schemastery', 'vendor/schemastery')
linkPkg(checkout, '@deepseek-ai/dsh-tools', 'packages/core/tools')
linkPkg(checkout, '@deepseek-ai/dsh-llm', 'packages/llm/llm')
linkPkg(checkout, '@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt')
linkPkg(checkout, '@types/node', 'node_modules/@types/node')

// Link @standard-schema/spec when the checkout's pnpm store has it.
const pnpmStore = join(checkout, 'node_modules', '.pnpm')
if (existsSync(pnpmStore)) {
  const entries = readdirSafe(pnpmStore)
  const specDir = entries.find((name) => name.startsWith('@standard-schema+spec@'))
  if (specDir) {
    const specTarget = join(pnpmStore, specDir, 'node_modules', '@standard-schema', 'spec')
    if (existsSync(specTarget)) {
      rmSync(join(ROOT, 'node_modules', '@standard-schema'), { recursive: true, force: true })
      mkdirSync(join(ROOT, 'node_modules', '@standard-schema'), { recursive: true })
      symlinkSync(resolve(specTarget), resolve(ROOT, 'node_modules', '@standard-schema', 'spec'), process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
}

console.log('=== Compiling src → lib ===')
const tscBin = join(checkout, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
if (!existsSync(tscBin)) {
  fail(`tsc not found at ${tscBin}`)
}
const result = spawnSync(tscBin, ['-p', 'tsconfig.json'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) {
  process.exit(result.status || 1)
}
console.log('=== Build complete ===')

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
