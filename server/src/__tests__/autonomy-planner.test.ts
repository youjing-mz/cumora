import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectOperatingContract } from '../autonomy/contract.js'
import {
  buildDefaultPlan,
  planContentHash,
  validatePlanPolicy,
} from '../autonomy/planner.js'

function contractFixture(): ProjectOperatingContract {
  return {
    apiVersion: 'cumora.ai/v1alpha1',
    kind: 'ProjectOperatingContract',
    metadata: { project: 'test', version: 1, owners: ['project_owner'] },
    repository: {
      url: 'git@example:test.git', defaultBranch: 'master', branchPrefix: 'codex/',
      writablePaths: ['src/**'], protectedPaths: ['.env*'],
    },
    intake: { conversationMode: 'bound_conversation', deduplicationWindowHours: 168 },
    actions: {
      'git.merge_master': { effect: 'require_approval', reason: 'protected branch', approvalRole: 'project_owner' },
      'deploy.staging': { effect: 'allow', reason: 'staging is the acceptance env' },
      'database.destructive_migration': { effect: 'deny', reason: 'out of scope' },
    },
    checks: { unit: { command: 'npm test', timeoutMinutes: 10 } },
    verification: { independent: true, requiredBeforeMerge: ['unit'], requiredEvidence: ['root_cause'] },
    budgets: { maxChangedFiles: 30, maxAttempts: 3, maxRuntimeMinutes: 120, maxModelCostUsd: 20 },
    runtime: { runner: 'codex', leaseMinutes: 10, unknownAction: 'stop_and_request_decision' },
  }
}

test('buildDefaultPlan derives a deterministic, unbound plan from the goal + contract', () => {
  const plan = buildDefaultPlan({ goal: 'Fix duplicate conversations', contract: contractFixture() })
  assert.equal(plan.problem, 'Fix duplicate conversations')
  assert.equal(plan.risk, 'medium')
  // Capabilities derived from the contract runner + staging allow.
  assert.ok(plan.requiredCapabilities.includes('repo:write'))
  assert.ok(plan.requiredCapabilities.includes('codex'))
  assert.ok(plan.requiredCapabilities.includes('staging:deploy'))
  // Only the merge approval is requested (governance-activation approvals aren't).
  assert.deepEqual(plan.approvalNeeds, ['git.merge_master'])
  // The check id shows up as an acceptance criterion.
  assert.ok(plan.acceptanceCriteria.some((c) => c.includes('required check unit passes')))
  // Responsibilities are declared but left unbound — the planner never invents
  // a Persona.
  assert.deepEqual(plan.responsibilities.map((r) => r.role), ['builder_owner', 'independent_verifier'])
  assert.ok(plan.responsibilities.every((r) => !r.preferredPersona))
})

test('validatePlanPolicy allows require_approval, blocks deny and unknown actions', () => {
  const contract = contractFixture()
  const base = buildDefaultPlan({ goal: 'x', contract })
  assert.deepEqual(validatePlanPolicy(base, contract), { ok: true })

  const denied = validatePlanPolicy({ ...base, approvalNeeds: ['database.destructive_migration'] }, contract)
  assert.equal(denied.ok, false)
  if (!denied.ok) assert.equal(denied.violation.decision, 'deny')

  const unknown = validatePlanPolicy({ ...base, approvalNeeds: ['made.up.action'] }, contract)
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.violation.decision, 'stop_and_request_decision')
})

test('planContentHash is stable for equal plans and differs for changed plans', () => {
  const contract = contractFixture()
  const a = buildDefaultPlan({ goal: 'same goal', contract })
  const b = buildDefaultPlan({ goal: 'same goal', contract })
  const c = buildDefaultPlan({ goal: 'different goal', contract })
  assert.equal(planContentHash(a), planContentHash(b))
  assert.notEqual(planContentHash(a), planContentHash(c))
})
