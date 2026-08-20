#!/usr/bin/env node

/**
 * Verifies that every literal i18n call has a Chinese result.
 *
 * The hard-coded-copy check catches JSX text that bypasses i18n. This check
 * catches the other failure mode: copy is wrapped in t()/translate(), but the
 * key or legacy source-copy alias has no Chinese translation.
 */
import fs from 'node:fs'
import path from 'node:path'
import { text } from '../src/i18n/index'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')

const intentionalSourceCopy = new Set([
  '@all', 'Claude Code', 'Codex', 'Grok Build', 'Cumora', 'Cumora Cloud',
  'Convene', 'Commit SHA', 'Kanban', 'LIVE', 'Max', 'Pro', 'Re:', 'Ctrl-C',
  'Alice', 'sub2api ID', '⌘K',
])

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(file)
    return entry.isFile() && file.endsWith('.tsx') ? [file] : []
  })
}

function isVisibleCopy(key: string): boolean {
  if (!/[A-Za-z]/.test(key)) return false
  if (intentionalSourceCopy.has(key)) return false
  if (/^[a-z0-9_.:/@-]+$/.test(key)) return false
  return true
}

const unresolved: Array<{ file: string; line: number; key: string }> = []
const callPattern = /(?:\bt|\btranslate|\btext)\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g

for (const file of listFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(callPattern)) {
    const rawKey = match[1] ?? match[2]
    const key = rawKey.replace(/\\([\\'"\\nrt])/g, (_, escaped: string) => ({
      '\\': '\\',
      "'": "'",
      '"': '"',
      n: '\n',
      r: '\r',
      t: '\t',
    }[escaped] ?? escaped))
    if (!isVisibleCopy(key) || text(key, 'zh') !== key) continue
    const line = source.slice(0, match.index ?? 0).split('\n').length
    unresolved.push({ file: path.relative(root, file), line, key })
  }
}

const unique = unresolved.filter((item, index, all) => all.findIndex((other) => (
  other.file === item.file && other.line === item.line && other.key === item.key
)) === index)

if (unique.length > 0) {
  console.error(`[i18n] ${unique.length} literal calls have no Chinese translation:`)
  for (const item of unique) console.error(`- ${item.file}:${item.line} ${item.key}`)
  process.exit(1)
}

console.log('[i18n] Chinese translation coverage passed for all literal UI calls.')
