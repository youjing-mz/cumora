import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  assertChangedPathsAllowed,
  ContractValidationError,
  compileJobEnvelope,
  decideAction,
  governanceLock,
  loadProjectGovernance,
} from '../autonomy/contract.js'

test('Git-managed Cumora governance validates and compiles deterministically', async () => {
  const governance = await loadProjectGovernance(resolve(process.cwd(), '.cumora'))
  assert.equal(governance.contract.metadata.project, 'cumora')
  assert.equal(governance.contract.metadata.version, 1)
  assert.equal(governance.contractHash.length, 64)
  assert.equal(governance.effectiveHash.length, 64)
  assert.match(governance.vision, /improve Cumora itself/i)

  assert.equal(decideAction(governance.contract, 'code.modify').decision, 'allow')
  assert.equal(decideAction(governance.contract, 'git.merge_master').decision, 'require_approval')
  assert.equal(decideAction(governance.contract, 'database.destructive_migration').decision, 'deny')
  assert.equal(decideAction(governance.contract, 'secret.export').decision, 'stop_and_request_decision')

  const envelope = compileJobEnvelope({
    governance,
    workItemId: 'AWI Example/Unsafe ID',
    runId: 'run-1',
    goal: 'Fix duplicate conversations',
  })
  assert.equal(envelope.contractHash, governance.contractHash)
  assert.equal(envelope.branch, 'codex/awi-example-unsafe-id')
  assert.ok(envelope.checks.some((check) => check.id === 'unit_tests'))
  assert.ok(envelope.approvalActions.some((item) => item.action === 'git.merge_master'))

  const lock = governanceLock(governance)
  assert.equal(lock.effectiveHash, governance.effectiveHash)
})

test('repository scope rejects protected, unknown and oversized changes', async () => {
  const { contract } = await loadProjectGovernance(resolve(process.cwd(), '.cumora'))
  assert.doesNotThrow(() => assertChangedPathsAllowed(contract, ['server/src/autonomy/contract.ts', '.cumora/vision.md']))
  assert.throws(
    () => assertChangedPathsAllowed(contract, ['server/k8s/cumora-server.gke.yaml']),
    (error: unknown) => error instanceof ContractValidationError && /protected paths/.test(error.message),
  )
  assert.throws(
    () => assertChangedPathsAllowed(contract, ['private/secret.txt']),
    (error: unknown) => error instanceof ContractValidationError && /outside writable paths/.test(error.message),
  )
  assert.throws(
    () => assertChangedPathsAllowed(contract, Array.from({ length: 31 }, (_, index) => `src/generated-${index}.ts`)),
    (error: unknown) => error instanceof ContractValidationError && /budget is 30/.test(error.message),
  )
})
