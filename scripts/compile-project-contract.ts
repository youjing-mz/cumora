import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { agentBrief, canonicalJson, governanceLock, loadProjectGovernance } from '../server/src/autonomy/contract.js'

const sourceRoot = resolve(process.cwd(), process.env.CUMORA_PROJECT_GOVERNANCE_ROOT || '.cumora')
const lockPath = resolve(sourceRoot, 'contract.lock.json')
const briefPath = resolve(sourceRoot, 'agent-brief.md')
const checkOnly = process.argv.includes('--check')

const governance = await loadProjectGovernance(sourceRoot)
const next = `${JSON.stringify(governanceLock(governance), null, 2)}\n`
const nextBrief = agentBrief(governance)
const current = await readFile(lockPath, 'utf8').catch(() => '')
const currentBrief = await readFile(briefPath, 'utf8').catch(() => '')

if (checkOnly && (current !== next || currentBrief !== nextBrief)) {
  console.error('compiled governance artifacts are stale; run npm run autonomy:contract:compile')
  process.exitCode = 1
} else if (!checkOnly) {
  if (current !== next) await writeFile(lockPath, next, 'utf8')
  if (currentBrief !== nextBrief) await writeFile(briefPath, nextBrief, 'utf8')
}

console.log(JSON.stringify({
  ok: (current === next && currentBrief === nextBrief) || !checkOnly,
  project: governance.contract.metadata.project,
  version: governance.contract.metadata.version,
  visionHash: governance.visionHash,
  contractHash: governance.contractHash,
  effectiveHash: governance.effectiveHash,
  policyCount: Object.keys(governance.contract.actions).length,
  checkCount: Object.keys(governance.contract.checks).length,
  canonicalBytes: canonicalJson(governance.contract).length,
}, null, 2))
