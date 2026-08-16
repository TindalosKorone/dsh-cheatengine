#!/usr/bin/env node
/**
 * Cross-platform host build for @tindalosko/dsh-cheatengine.
 *
 * Compiles src/ → lib/ using TypeScript. Resolves tsc from, in order:
 *   1. DSH_CHECKOUT/node_modules/.bin/tsc
 *   2. local node_modules/.bin/tsc
 *   3. local node_modules/typescript/bin/tsc
 *   4. the bootstrap temp tsc used by this repo's local toolchain
 *      (%TEMP%/tsc-build/extract/package/bin/tsc)
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const tsconfig = join(root, 'tsconfig.json')

function findTsc() {
  const checkout = process.env.DSH_CHECKOUT
  const candidates = []
  if (checkout) {
    candidates.push(join(checkout, 'node_modules', '.bin', 'tsc.cmd'))
    candidates.push(join(checkout, 'node_modules', '.bin', 'tsc'))
  }
  candidates.push(join(root, 'node_modules', '.bin', 'tsc.cmd'))
  candidates.push(join(root, 'node_modules', '.bin', 'tsc'))
  candidates.push(join(root, 'node_modules', 'typescript', 'bin', 'tsc'))
  const temp = process.env.TEMP || process.env.TMP
  if (temp) {
    candidates.push(join(temp, 'tsc-build', 'extract', 'package', 'bin', 'tsc'))
  }
  return candidates.find((p) => existsSync(p)) ?? null
}

function runTsc(tsc, noEmit) {
  const args = ['-p', tsconfig]
  if (noEmit) args.push('--noEmit')
  const ext = extname(tsc).toLowerCase()
  const res = ext === '.cmd' || ext === '.bat'
    ? spawnSync(tsc, args, { stdio: 'inherit', shell: true })
    : spawnSync(process.execPath, [tsc, ...args], { stdio: 'inherit' })

  if (res.error) {
    console.error(`[build] Failed to spawn tsc: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

const tsc = findTsc()
if (!tsc) {
  console.error('[build] Could not locate tsc. Set DSH_CHECKOUT or install TypeScript locally.')
  process.exit(1)
}

const noEmit = process.argv.includes('--noEmit')

console.log(`[build] Using tsc: ${tsc}`)
runTsc(tsc, noEmit)
console.log(noEmit ? '[build] Typecheck complete' : '[build] Host build complete')
