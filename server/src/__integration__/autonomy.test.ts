import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import {
  buildApiTestApp,
  ensureSchemaOnce,
  resetAllTables,
  seedUserMembership,
  teardownAll,
} from './_helpers.js'

const USER_ID = 'u-autonomy-owner'
const COMPANY_ID = 'c-autonomy'
const PROJECT_ID = 'p-cumora'
const CONVERSATION_ID = 'c-cumora-project'
const COMPUTER_ID = 'computer-autonomy'
const DEVICE_TOKEN = 'autonomy-device-secret'
let server: Server
let baseUrl = ''

before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp(USER_ID)
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => {
      const address = server.address()
      if (address && typeof address === 'object') baseUrl = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })
})

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Autonomy Co','autonomy-co',$2)`,
    [COMPANY_ID, USER_ID],
  )
  await seedUserMembership(USER_ID, COMPANY_ID, { displayName: 'Project Owner' })
  await pool.query(
    `INSERT INTO projects (id,company_id,name,description) VALUES ($1,$2,'Cumora','Self hosting')`,
    [PROJECT_ID, COMPANY_ID],
  )
  await pool.query(
    `INSERT INTO conversations (id,kind,title,members,company_id,project_id)
     VALUES ($1,'group','Cumora project',$2::jsonb,$3,$4)`,
    [CONVERSATION_ID, JSON.stringify([USER_ID]), COMPANY_ID, PROJECT_ID],
  )
  await pool.query(
    `INSERT INTO computers
       (id,company_id,owner_user_id,name,kind,available_engines,status,credential_hash,paired_at)
     VALUES ($1,$2,$3,'Autonomy Node','local','["codex"]'::jsonb,'online',$4,NOW())`,
    [COMPUTER_ID, COMPANY_ID, USER_ID, createHash('sha256').update(DEVICE_TOKEN).digest('base64url')],
  )
})

after(async () => { await teardownAll(server) })

async function human(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-company-id': COMPANY_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

async function node(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${DEVICE_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

async function sendProjectMessage(body: string, clientId: string) {
  const response = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-company-id': COMPANY_ID },
    body: JSON.stringify({ body, clientId }),
  })
  return { response, json: await response.json() as any }
}

test('[integration] Cumora Git governance drives instruction to audited merge approval', async () => {
  const synced = await human(`/projects/${PROJECT_ID}/sync-git`, 'POST', { revision: 'test-commit-abc' })
  assert.equal(synced.response.status, 201)
  assert.equal(synced.json.version, 1)
  assert.equal(synced.json.effectiveHash.length, 64)

  const configured = await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates',
    conversationId: CONVERSATION_ID,
    computerId: COMPUTER_ID,
  })
  assert.equal(configured.response.status, 200)

  const created = await sendProjectMessage('修复会话重复', 'duplicate-conversations-message-1')
  assert.equal(created.response.status, 202)
  const { workItemId, runId } = created.json.autonomy
  assert.ok(workItemId)
  assert.ok(runId)

  const duplicate = await sendProjectMessage('修复会话重复', 'duplicate-conversations-message-1')
  assert.equal(duplicate.response.status, 202)
  const workItemCount = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM autonomy_work_items WHERE project_id=$1`,
    [PROJECT_ID],
  )
  assert.equal(workItemCount.rows[0]?.count, 1)

  const claimed = await node('/jobs/claim', {})
  assert.equal(claimed.response.status, 200)
  assert.equal(claimed.json.runId, runId)
  assert.equal(claimed.json.envelope.goal, '修复会话重复')
  assert.ok(claimed.json.envelope.approvalActions.some((item: any) => item.action === 'git.merge_master'))

  const heartbeat = await node(`/jobs/${runId}/heartbeat`, { leaseToken: claimed.json.leaseToken })
  assert.equal(heartbeat.response.status, 200)

  const incomplete = await node(`/jobs/${runId}/complete`, {
    leaseToken: claimed.json.leaseToken,
    outcome: 'ready_for_merge',
    builderId: 'codex-builder',
    summary: 'Implemented the fix but evidence is incomplete.',
    evidence: [{ kind: 'root_cause', producerId: 'codex-builder', payload: { note: 'duplicate projection rows' } }],
  })
  assert.equal(incomplete.response.status, 200)
  assert.equal(incomplete.json.status, 'verifying')
  assert.ok(incomplete.json.missingEvidence.includes('pull_request'))

  const completed = await node(`/jobs/${runId}/complete`, {
    leaseToken: claimed.json.leaseToken,
    outcome: 'ready_for_merge',
    builderId: 'codex-builder',
    summary: 'Canonical conversation identity now has regression coverage and staging proof.',
    evidence: [
      { kind: 'diff_summary', producerId: 'codex-builder', payload: { files: ['src/stores/conversations.ts'] } },
      { kind: 'required_checks', producerId: 'deterministic-checker', payload: { passed: true } },
      { kind: 'independent_verification', producerId: 'codex-verifier', payload: { verdict: 'PASS' } },
      { kind: 'staging_smoke', producerId: 'staging-adapter', payload: { path: 'conversation-list', passed: true } },
      { kind: 'pull_request', producerId: 'github-adapter', payload: { url: 'https://github.test/cumora/pull/42' } },
      { kind: 'rollback_plan', producerId: 'codex-builder', payload: { plan: 'revert the merge commit' } },
    ],
  })
  assert.equal(completed.response.status, 200)
  assert.equal(completed.json.status, 'awaiting_merge')
  assert.ok(completed.json.approvalId)

  const snapshot = await human(`/projects/${PROJECT_ID}`)
  assert.equal(snapshot.response.status, 200)
  assert.equal(snapshot.json.project.contractRevision, 'test-commit-abc')
  assert.equal(snapshot.json.project.contractHash, claimed.json.envelope.contractHash)
  assert.equal(snapshot.json.workItems[0].status, 'awaiting_merge')
  assert.equal(snapshot.json.approvals[0].action, 'git.merge_master')
  assert.deepEqual(
    snapshot.json.events.slice(0, 2).map((event: any) => event.kind),
    ['approval.requested', 'run.evidence_missing'],
  )
  // `run.leased` and `run.assignment.created` are emitted in the same claim
  // transaction (identical timestamps), so assert on the set rather than a
  // tie-dependent order.
  assert.deepEqual(
    new Set(snapshot.json.events.slice(2, 4).map((event: any) => event.kind)),
    new Set(['run.leased', 'run.assignment.created']),
  )

  const approved = await human(`/approvals/${completed.json.approvalId}/decision`, 'POST', {
    decision: 'approved',
    note: 'Evidence accepted; merge through the protected branch UI.',
  })
  assert.equal(approved.response.status, 200)
  assert.equal(approved.json.workItemStatus, 'approved_for_merge')

  const merged = await human(`/work-items/${workItemId}/merged`, 'POST', {
    commitSha: 'abcdef1234567890',
    pullRequestUrl: 'https://github.test/cumora/pull/42',
  })
  assert.equal(merged.response.status, 200)
  assert.equal(merged.json.status, 'releasing')

  const deployment = await node('/jobs/claim', {})
  assert.equal(deployment.response.status, 200)
  assert.equal(deployment.json.envelope.jobType, 'deployment')
  const deployed = await node(`/jobs/${deployment.json.runId}/complete`, {
    leaseToken: deployment.json.leaseToken,
    outcome: 'completed',
    builderId: 'production-adapter',
    summary: 'Production rollout and smoke passed.',
    evidence: [{ kind: 'production_deployment', producerId: 'production-adapter', payload: { healthy: true } }],
  })
  assert.equal(deployed.response.status, 200)
  assert.equal(deployed.json.status, 'watching')
  assert.ok(deployed.json.nextRunId)

  const readback = await node('/jobs/claim', {})
  assert.equal(readback.response.status, 200)
  assert.equal(readback.json.envelope.jobType, 'readback')
  const readbackDone = await node(`/jobs/${readback.json.runId}/complete`, {
    leaseToken: readback.json.leaseToken,
    outcome: 'completed',
    builderId: 'readback-adapter',
    summary: 'Production error rate and conversation-list path remained healthy.',
    evidence: [{ kind: 'production_readback', producerId: 'readback-adapter', payload: { healthy: true } }],
  })
  assert.equal(readbackDone.response.status, 200)
  assert.equal(readbackDone.json.status, 'completed')

  const finalSnapshot = await human(`/projects/${PROJECT_ID}`)
  assert.equal(finalSnapshot.json.workItems[0].status, 'completed')

  const evidenceRows = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM autonomy_evidence WHERE work_item_id=$1`,
    [workItemId],
  )
  assert.equal(evidenceRows.rows[0]?.count, 10)
  const shippingRows = await pool.query<{ status: string }>(
    `SELECT status FROM shipping_features WHERE id=$1`,
    [snapshot.json.workItems[0].shippingFeatureId],
  )
  assert.equal(shippingRows.rows[0]?.status, 'learned')
  const releaseRows = await pool.query<{ status: string; readbackStatus: string }>(
    `SELECT status,readback_status AS "readbackStatus" FROM shipping_releases
      WHERE feature_id=$1 AND environment='production'`,
    [snapshot.json.workItems[0].shippingFeatureId],
  )
  assert.deepEqual(releaseRows.rows[0], { status: 'succeeded', readbackStatus: 'passed' })
})

test('[integration] stale lease and self-verification cannot open merge approval', async () => {
  await human(`/projects/${PROJECT_ID}/sync-git`, 'POST', {})
  await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates', conversationId: CONVERSATION_ID, computerId: COMPUTER_ID,
  })
  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'A gated change' })
  const claimed = await node('/jobs/claim', {})

  const selfVerified = await node(`/jobs/${created.json.runId}/complete`, {
    leaseToken: claimed.json.leaseToken,
    outcome: 'ready_for_merge',
    builderId: 'same-agent',
    summary: 'Self verified',
    evidence: [
      { kind: 'root_cause', producerId: 'same-agent', payload: {} },
      { kind: 'diff_summary', producerId: 'same-agent', payload: {} },
      { kind: 'required_checks', producerId: 'same-agent', payload: {} },
      { kind: 'independent_verification', producerId: 'same-agent', payload: {} },
      { kind: 'staging_smoke', producerId: 'same-agent', payload: {} },
      { kind: 'pull_request', producerId: 'same-agent', payload: {} },
    ],
  })
  assert.equal(selfVerified.response.status, 409)
  assert.match(selfVerified.json.error, /cannot provide independent/i)

  const stale = await node(`/jobs/${created.json.runId}/heartbeat`, { leaseToken: 'wrong-token' })
  assert.equal(stale.response.status, 409)
})
