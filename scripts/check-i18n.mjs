#!/usr/bin/env node

/**
 * Static i18n guard for user-visible React copy.
 *
 * Default mode is a no-regression gate: known legacy findings are reported
 * but do not fail the build; newly introduced findings do. `--strict` turns
 * every finding into an error while the remaining legacy copy is migrated.
 *
 * This intentionally checks JSX text and visible attributes only. It does
 * not inspect logs, API payloads, CSS/class names, protocol values, or user
 * generated content.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const baselinePath = path.join(root, 'scripts', 'i18n-baseline.json')
const strict = process.argv.includes('--strict') || process.env.I18N_STRICT === '1'

const visibleAttributes = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
  'ariaLabel',
])

const ignoredTags = new Set(['code', 'pre', 'script', 'style'])
const ignoredAttributeNames = new Set([
  'className', 'class', 'style', 'id', 'key', 'name', 'type', 'value',
  'href', 'src', 'target', 'rel', 'role', 'method', 'action', 'accept',
  'autoComplete', 'autoCapitalize', 'enterKeyHint', 'spellCheck',
  'data-testid', 'data-state', 'data-value', 'data-kind', 'data-provider',
])

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(file))
    else if (entry.isFile() && file.endsWith('.tsx')) out.push(file)
  }
  return out
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function looksLikeCopy(value) {
  const text = normalize(value)
  if (!text || !/[A-Za-z\u3400-\u9fff]/.test(text)) return false
  if (/^&[A-Za-z]+;$/.test(text)) return false
  if (/^(https?:\/\/|data:|var\(|rgba?\(|#[0-9a-f]{3,8}\b)/i.test(text)) return false
  if (/^[A-Za-z0-9_.:/@-]+$/.test(text) && !text.includes(' ')) return false
  return true
}

function isInIgnoredTag(stack) {
  return stack.some((node) => {
    if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return false
    const tagNode = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
    const tag = tagNode?.getText?.() ?? ''
    return ignoredTags.has(tag)
  })
}

function isInsideTranslationCall(stack) {
  return stack.some((node) => {
    if (!ts.isCallExpression(node)) return false
    const expression = node.expression.getText()
    return expression === 't' || expression === 'text' || expression.endsWith('.t')
  })
}

function attributeName(attribute) {
  return ts.isIdentifier(attribute.name) || ts.isStringLiteral(attribute.name)
    ? attribute.name.text
    : attribute.name.getText()
}

function literalValue(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isJsxExpression(node) && node.expression) {
    if (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) return node.expression.text
  }
  return null
}

function addFinding(findings, sourceFile, node, kind, raw) {
  const text = normalize(raw)
  if (!looksLikeCopy(text)) return
  findings.push({
    file: path.relative(root, sourceFile.fileName),
    kind,
    text,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  })
}

function scanFile(file) {
  if (file.endsWith(`${path.sep}src${path.sep}i18n${path.sep}index.ts`)) return []
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings = []

  function visit(node, stack = []) {
    if (ts.isJsxText(node) && !isInIgnoredTag(stack)) {
      addFinding(findings, sourceFile, node, 'jsx-text', node.getText(sourceFile))
    }

    if (ts.isJsxAttribute(node)) {
      const name = attributeName(node)
      const raw = literalValue(node.initializer)
      if (raw !== null && visibleAttributes.has(name) && !ignoredAttributeNames.has(name)) {
        addFinding(findings, sourceFile, node, `attribute:${name}`, raw)
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isInsideTranslationCall(stack)) {
      const jsxAttribute = stack.find((ancestor) => ts.isJsxAttribute(ancestor))
      if (!jsxAttribute) {
        const jsxExpression = stack.find((ancestor) => ts.isJsxExpression(ancestor))
        if (jsxExpression && !isInIgnoredTag(stack)) {
          addFinding(findings, sourceFile, node, 'jsx-expression', node.text)
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, [...stack, node]))
  }

  visit(sourceFile)
  return findings
}

function fingerprint(finding) {
  return `${finding.file}|${finding.kind}|${finding.text}`
}

const findings = listFiles(sourceRoot)
  .flatMap(scanFile)
  .filter((finding, index, all) => fingerprint(finding) && all.findIndex((other) => fingerprint(other) === fingerprint(finding)) === index)
  .sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)))

let baseline = []
if (fs.existsSync(baselinePath)) {
  baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
}
const baselineFingerprint = (item) => typeof item === 'string' ? item : item.fingerprint ?? fingerprint(item)
const baselineSet = new Set(baseline.map(baselineFingerprint))
const currentSet = new Set(findings.map(fingerprint))
const newFindings = findings.filter((finding) => !baselineSet.has(fingerprint(finding)))
const legacyFindings = findings.filter((finding) => baselineSet.has(fingerprint(finding)))
const resolved = baseline.filter((item) => !currentSet.has(baselineFingerprint(item)))

console.log(`[i18n] ${findings.length} hard-coded UI strings found (${legacyFindings.length} legacy, ${newFindings.length} new).`)
if (resolved.length > 0) console.log(`[i18n] ${resolved.length} baseline entries are resolved; run --update-baseline to prune them.`)

const print = (title, list) => {
  if (list.length === 0) return
  console.log(`\n${title}`)
  for (const finding of list) console.log(`- ${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`)
}

print('[i18n] New findings', newFindings)
if (strict) print('[i18n] All findings', findings)

if (process.argv.includes('--update-baseline')) {
  const next = findings.map(fingerprint)
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`[i18n] baseline updated: ${next.length} entries`)
}

if (strict ? findings.length > 0 : newFindings.length > 0) {
  console.error(strict
    ? '\n[i18n] FAILED: every hard-coded UI string must use the i18n catalog.'
    : '\n[i18n] FAILED: new hard-coded UI strings detected. Use useI18n().t(...) or add an explicit migration entry.')
  process.exitCode = 1
}
