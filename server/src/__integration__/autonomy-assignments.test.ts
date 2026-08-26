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

const USER_ID = 'u-assign-owner'
const COMPANY_ID = 'c-assign'
const PROJECT_ID = 'p-assign'
const CONVERSATION_ID = 'c-assign-project'
const COMPUTER_ID = 'computer-assign'
const DEVICE_TOKEN = 'assign-device-secret'
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

async function seedAgent(id: string, name: string, opts: { companyId?: string; departed?: boolean } = {}) {
  await pool.query(
    `INSERT INTO participants (id,company_id,kind,name,role,initial,avatar_bg,status,departed_at)
     VALUES ($1,$2,'agent',$3,'engineer',$4,'#abcdef','avail',$5)
     ON CONFLICT DO NOTHING`,
    [id, opts.companyId ?? COMPANY_ID, name, name.slice(0, 1).toUpperCase(), opts.departed ? new Date() : null],
  )
}

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Assign Co','assign-co',$2)`,
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
     VALUES ($1,$2,$3,'Assign Node','local','["codex"]'::jsonb,'online',$4,NOW())`,
    [COMPUTER_ID, COMPANY_ID, USER_ID, createHash('sha256').update(DEVICE_TOKEN).digest('base64url')],
  )
  await seedAgent('bram', 'Bram')
  await seedAgent('iris', 'Iris')
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

/** Sync governance, enable execution, create a work item and claim its run so
 *  a builder_owner execution assignment already exists. Returns the run id. */
async function claimedRun(goal: string): Promise<string> {
  await human(`/projects/${PROJECT_ID}/sync-git`, 'POST', {})
  await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates', conversationId: CONVERSATION_ID, computerId: COMPUTER_ID,
  })
  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal })
  assert.ok(created.json.runId)
  const claimed = await node('/jobs/claim', {})
  assert.equal(claimed.response.status, 200)
  return created.json.runId as string
}

function assignmentFor(snapshot: any, responsibility: string) {
  return snapshot.json.assignments.find((a: any) => a.responsibility === responsibility)
}

test('[integration] claim binds a server-issued builder execution identity', async () => {
  const runId = await claimedRun('bind execution identity')
  const snapshot = await human(`/projects/${PROJECT_ID}`)
  const builder = assignmentFor(snapshot, 'builder_owner')
  assert.ok(builder, 'claim should record a builder_owner assignment')
  assert.equal(builder.runId, runId)
  assert.equal(builder.workerId, COMPUTER_ID)
  assert.equal(builder.computerId, COMPUTER_ID)
  assert.equal(builder.producerId, COMPUTER_ID)
  assert.equal(builder.engine, 'codex')
  assert.equal(builder.visibility, 'internal')
  assert.equal(builder.personaAgentId, null)
  assert.ok(snapshot.json.events.some((e: any) => e.kind === 'run.assignment.created'))
})

test('[integration] a Run shows both the responsible Persona and the executing Worker', async () => {
  const runId = await claimedRun('persona plus worker')
  const assigned = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'builder_owner', personaAgentId: 'bram',
  })
  // Claim already created the row, so naming the persona is a change (200).
  assert.equal(assigned.response.status, 200)
  assert.equal(assigned.json.created, false)

  const snapshot = await human(`/projects/${PROJECT_ID}`)
  const builder = assignmentFor(snapshot, 'builder_owner')
  assert.equal(builder.personaAgentId, 'bram')
  assert.equal(builder.personaName, 'Bram')
  assert.equal(builder.workerId, COMPUTER_ID)     // executor preserved through the merge
  assert.equal(builder.visibility, 'visible')      // gains a Persona → visible
  assert.ok(snapshot.json.events.some((e: any) => e.kind === 'run.assignment.changed'))
})

test('[integration] off-boarded personas cannot receive new assignments', async () => {
  const runId = await claimedRun('no off-board assignment')
  await seedAgent('ghost', 'Ghost', { departed: true })
  const rejected = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'design_reviewer', personaAgentId: 'ghost',
  })
  assert.equal(rejected.response.status, 400)
  assert.match(rejected.json.error, /off-boarded|unknown|another company/i)
})

test('[integration] assignments cannot reference another company persona or computer', async () => {
  const runId = await claimedRun('tenant isolation')
  const otherUser = 'u-other'
  const otherCompany = 'c-other'
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Other Co','other-co',$2)`,
    [otherCompany, otherUser],
  )
  await seedUserMembership(otherUser, otherCompany, { displayName: 'Other Owner' })
  await seedAgent('foreign-persona', 'Foreigner', { companyId: otherCompany })
  await pool.query(
    `INSERT INTO computers
       (id,company_id,owner_user_id,name,kind,available_engines,status,credential_hash,paired_at)
     VALUES ('foreign-computer',$1,$2,'Foreign Node','local','["codex"]'::jsonb,'online','x',NOW())`,
    [otherCompany, otherUser],
  )

  const foreignPersona = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'design_reviewer', personaAgentId: 'foreign-persona',
  })
  assert.equal(foreignPersona.response.status, 400)

  const foreignComputer = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'deployment_operator', computerId: 'foreign-computer',
  })
  assert.equal(foreignComputer.response.status, 400)
})

test('[integration] one persona cannot be both builder owner and independent verifier', async () => {
  const runId = await claimedRun('builder is not verifier')
  const asBuilder = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'builder_owner', personaAgentId: 'bram',
  })
  assert.equal(asBuilder.response.status, 200)

  const asVerifier = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'independent_verifier', personaAgentId: 'bram',
  })
  assert.equal(asVerifier.response.status, 409)
  assert.match(asVerifier.json.error, /independent verifier/i)

  // A different persona is fine as the independent verifier.
  const iris = await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'independent_verifier', personaAgentId: 'iris',
  })
  assert.equal(iris.response.status, 201)
})

test('[integration] completion rejects independent verification from the builder execution identity', async () => {
  const runId = await claimedRun('server-identity independence')
  const claimedLease = await pool.query<{ leaseToken: string }>(
    `SELECT lease_token AS "leaseToken" FROM autonomy_runs WHERE id=$1`,
    [runId],
  )
  const leaseToken = claimedLease.rows[0].leaseToken
  const selfVerified = await node(`/jobs/${runId}/complete`, {
    leaseToken,
    outcome: 'ready_for_merge',
    builderId: 'codex-builder',
    summary: 'Tried to self-verify from the executing device',
    evidence: [
      // producer is the claiming device — the server-bound builder identity.
      { kind: 'independent_verification', producerId: COMPUTER_ID, payload: { verdict: 'PASS' } },
    ],
  })
  assert.equal(selfVerified.response.status, 409)
  assert.match(selfVerified.json.error, /cannot provide independent/i)
})
