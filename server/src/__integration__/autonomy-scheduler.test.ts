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

const USER_ID = 'u-sched-owner'
const COMPANY_ID = 'c-sched'
const PROJECT_ID = 'p-sched'
const CONVERSATION_ID = 'c-sched-project'
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

after(async () => { await teardownAll(server) })

async function seedComputer(id: string, token: string) {
  await pool.query(
    `INSERT INTO computers
       (id,company_id,owner_user_id,name,kind,available_engines,status,credential_hash,paired_at)
     VALUES ($1,$2,$3,$1,'local','["codex"]'::jsonb,'online',$4,NOW())`,
    [id, COMPANY_ID, USER_ID, createHash('sha256').update(token).digest('base64url')],
  )
}

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Sched Co','sched-co',$2)`,
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
  // No bound computer: runs are unassigned so eligibility is decided purely by
  // capabilities, not by an assigned_computer_id preference.
  await human(`/projects/${PROJECT_ID}/sync-git`, 'POST', {})
  await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates', conversationId: CONVERSATION_ID,
  })
})

async function human(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-company-id': COMPANY_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

async function node(token: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

// The Cumora default plan requires staging:deploy (deploy.staging is allowed),
// so a node without it cannot claim an implementation job.
const FULL_CAPS = ['repo:read', 'repo:write', 'codex', 'staging:deploy']
const NO_STAGING = ['repo:read', 'repo:write', 'codex']

test('[integration] a node without a required capability cannot claim; a capable one can', async () => {
  await seedComputer('cap-weak', 'token-weak')
  await seedComputer('cap-full', 'token-full')
  await human('/computers/cap-weak/capabilities', 'POST', { capabilities: NO_STAGING })
  await human('/computers/cap-full/capabilities', 'POST', { capabilities: FULL_CAPS })

  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'Fix duplicate conversations' })
  const runId = created.json.runId

  const weak = await node('token-weak', '/jobs/claim', {})
  assert.equal(weak.response.status, 204) // capability mismatch → nothing to claim

  const full = await node('token-full', '/jobs/claim', {})
  assert.equal(full.response.status, 200)
  assert.equal(full.json.runId, runId)
  assert.equal(full.json.attempt, 1)
})

test('[integration] two nodes cannot both claim the same run', async () => {
  await seedComputer('cap-a', 'token-a')
  await seedComputer('cap-b', 'token-b')
  await human('/computers/cap-a/capabilities', 'POST', { capabilities: FULL_CAPS })
  await human('/computers/cap-b/capabilities', 'POST', { capabilities: FULL_CAPS })

  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'Only-once claim' })
  const [a, b] = await Promise.all([
    node('token-a', '/jobs/claim', {}),
    node('token-b', '/jobs/claim', {}),
  ])
  const claimed = [a, b].filter((r) => r.response.status === 200)
  const empty = [a, b].filter((r) => r.response.status === 204)
  assert.equal(claimed.length, 1)
  assert.equal(empty.length, 1)
  assert.equal(claimed[0].json.runId, created.json.runId)
})

test('[integration] an expired lease is fenced out and re-claims as a new attempt', async () => {
  await seedComputer('cap-full', 'token-full')
  await human('/computers/cap-full/capabilities', 'POST', { capabilities: FULL_CAPS })
  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'Fencing' })
  const runId = created.json.runId

  const claimed = await node('token-full', '/jobs/claim', {})
  assert.equal(claimed.json.attempt, 1)

  // Force the lease to expire.
  await pool.query(
    `UPDATE autonomy_runs SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1`, [runId],
  )

  // Fencing preflight and completion both refuse the stale attempt.
  const preflight = await node('token-full', `/jobs/${runId}/preflight`, { leaseToken: claimed.json.leaseToken })
  assert.equal(preflight.response.status, 409)
  const stale = await node('token-full', `/jobs/${runId}/complete`, {
    leaseToken: claimed.json.leaseToken, outcome: 'ready_for_merge',
    builderId: 'codex-builder', summary: 'stale', evidence: [],
  })
  assert.equal(stale.response.status, 409)

  // Re-claim returns the run as a fresh attempt with a new lease.
  const reclaimed = await node('token-full', '/jobs/claim', {})
  assert.equal(reclaimed.response.status, 200)
  assert.equal(reclaimed.json.runId, runId)
  assert.equal(reclaimed.json.attempt, 2)
  assert.notEqual(reclaimed.json.leaseToken, claimed.json.leaseToken)

  // A valid preflight now succeeds under the fresh lease.
  const ok = await node('token-full', `/jobs/${runId}/preflight`, { leaseToken: reclaimed.json.leaseToken })
  assert.equal(ok.response.status, 200)
  assert.equal(ok.json.ok, true)
})

test('[integration] max_concurrent_jobs caps how many leases a node holds', async () => {
  await seedComputer('cap-full', 'token-full')
  await human('/computers/cap-full/capabilities', 'POST', { capabilities: FULL_CAPS, maxConcurrentJobs: 1 })
  await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'First job', idempotencyKey: 'one' })
  await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal: 'Second job', idempotencyKey: 'two' })

  const first = await node('token-full', '/jobs/claim', {})
  assert.equal(first.response.status, 200)
  const second = await node('token-full', '/jobs/claim', {})
  assert.equal(second.response.status, 204) // already at the concurrency cap
})
