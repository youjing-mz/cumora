import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) return []
      return collectTests(path)
    }
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : []
  }))
  return nested.flat()
}

const roots = [
  resolve(process.cwd(), 'server/src/__tests__'),
  resolve(process.cwd(), 'workers/email-gate/src'),
  resolve(process.cwd(), 'workers/r2-gate/src'),
]
const tests = (await Promise.all(roots.map(collectTests))).flat().sort()
if (tests.length === 0) {
  console.error('no unit test files found')
  process.exit(1)
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  stdio: 'inherit',
  env: process.env,
})
child.once('error', (error) => {
  console.error(error)
  process.exit(1)
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
