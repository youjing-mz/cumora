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

const USER_ID = 'u-review-owner'
const COMPANY_ID = 'c-review'
const PROJECT_ID = 'p-review'
const CONVERSATION_ID = 'c-review-project'
const COMPUTER_ID = 'computer-review'
const DEVICE_TOKEN = 'review-device-secret'
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

async function seedAgent(id: string, name: string) {
  await pool.query(
    `INSERT INTO participants (id,company_id,kind,name,role,initial,avatar_bg,status)
     VALUES ($1,$2,'agent',$3,'engineer',$4,'#abcdef','avail') ON CONFLICT DO NOTHING`,
    [id, COMPANY_ID, name, name.slice(0, 1).toUpperCase()],
  )
}

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Review Co','review-co',$2)`,
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
     VALUES ($1,$2,$3,'Review Node','local','["codex"]'::jsonb,'online',$4,NOW())`,
    [COMPUTER_ID, COMPANY_ID, USER_ID, createHash('sha256').update(DEVICE_TOKEN).digest('base64url')],
  )
  await seedAgent('bram', 'Bram')
  await seedAgent('iris', 'Iris')
  await human(`/projects/${PROJECT_ID}/sync-git`, 'POST', {})
  await human(`/projects/${PROJECT_ID}/configure`, 'POST', {
    mode: 'execute_with_gates', conversationId: CONVERSATION_ID, computerId: COMPUTER_ID,
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

async function node(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/autonomy${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${DEVICE_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = response.status === 204 ? null : await response.json() as any
  return { response, json }
}

async function newRun(goal: string, key: string): Promise<string> {
  const created = await human(`/projects/${PROJECT_ID}/work-items`, 'POST', { goal, idempotencyKey: key })
  assert.ok(created.json.runId)
  return created.json.runId as string
}

test('[integration] a Persona not assigned the responsibility cannot submit a review', async () => {
  const runId = await newRun('Redesign login', 'r1')
  const rejected = await human(`/runs/${runId}/reviews`, 'POST', {
    personaAgentId: 'iris', responsibility: 'design_reviewer',
    submission: 'review_evidence', verdict: 'passed', summary: 'looks good',
  })
  assert.equal(rejected.response.status, 403)
  assert.match(rejected.json.error, /not assigned/i)
})

test('[integration] an assigned reviewer submits review evidence that never changes run state', async () => {
  const runId = await newRun('Redesign login', 'r2')
  await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'design_reviewer', personaAgentId: 'iris',
  })
  const review = await human(`/runs/${runId}/reviews`, 'POST', {
    personaAgentId: 'iris', responsibility: 'design_reviewer',
    submission: 'review_evidence', verdict: 'passed', summary: 'spacing and contrast pass',
  })
  assert.equal(review.response.status, 201)
  assert.ok(review.json.evidenceId)

  const snapshot = await human(`/projects/${PROJECT_ID}`)
  const design = snapshot.json.reviews.find((r: any) => r.kind === 'design_review')
  assert.ok(design)
  assert.equal(design.producerId, 'iris')
  assert.equal(design.producerName, 'Iris')
  assert.equal(design.status, 'passed')
  // A design review is evidence only — it does not advance the run/work item.
  assert.equal(snapshot.json.workItems[0].status, 'queued')
  assert.ok(snapshot.json.events.some((e: any) => e.kind === 'review.submitted'))
})

test('[integration] the builder owner Persona cannot provide independent verification', async () => {
  const runId = await newRun('A gated change', 'r3')
  await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'builder_owner', personaAgentId: 'bram',
  })
  // Bypass the assignment endpoint's own independence guard to prove the review
  // path independently refuses a builder-owned verification.
  await pool.query(
    `INSERT INTO autonomy_run_assignments
       (id,company_id,project_id,work_item_id,run_id,responsibility,persona_agent_id,visibility,assigned_by)
     SELECT 'ara-forced',company_id,project_id,work_item_id,id,'independent_verifier','bram','visible','test'
       FROM autonomy_runs WHERE id=$1`,
    [runId],
  )
  const rejected = await human(`/runs/${runId}/reviews`, 'POST', {
    personaAgentId: 'bram', responsibility: 'independent_verifier',
    submission: 'review_evidence', verdict: 'passed', summary: 'I approve my own work',
  })
  assert.equal(rejected.response.status, 409)
  assert.match(rejected.json.error, /independent verification/i)
})

test('[integration] an assigned independent verifier Persona satisfies the merge gate', async () => {
  const runId = await newRun('Fix duplicate conversations', 'r4')
  await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'independent_verifier', personaAgentId: 'iris',
  })
  // Iris provides the independent verification as a server-verified Persona.
  const verified = await human(`/runs/${runId}/reviews`, 'POST', {
    personaAgentId: 'iris', responsibility: 'independent_verifier',
    submission: 'review_evidence', verdict: 'passed', summary: 'diff is focused and covered',
  })
  assert.equal(verified.response.status, 201)

  // The worker completes WITHOUT its own independent verification; the gate is
  // satisfied by the Persona's server-verified verification.
  const claimed = await node('/jobs/claim', {})
  assert.equal(claimed.response.status, 200)
  const completed = await node(`/jobs/${runId}/complete`, {
    leaseToken: claimed.json.leaseToken, outcome: 'ready_for_merge', builderId: 'codex-builder',
    summary: 'implemented',
    evidence: [
      { kind: 'root_cause', producerId: 'codex-builder', payload: {} },
      { kind: 'diff_summary', producerId: 'codex-builder', payload: {} },
      { kind: 'required_checks', producerId: 'checker', payload: {} },
      { kind: 'staging_smoke', producerId: 'staging', payload: {} },
      { kind: 'pull_request', producerId: 'github', payload: {} },
      { kind: 'rollback_plan', producerId: 'codex-builder', payload: {} },
    ],
  })
  assert.equal(completed.response.status, 200)
  assert.equal(completed.json.status, 'awaiting_merge')
  assert.ok(completed.json.approvalId)
})

test('[integration] a Persona can open a decision request without changing run state', async () => {
  const runId = await newRun('Ambiguous goal', 'r5')
  await human(`/projects/${PROJECT_ID}/runs/${runId}/assignments`, 'POST', {
    responsibility: 'design_reviewer', personaAgentId: 'iris',
  })
  const decision = await human(`/runs/${runId}/reviews`, 'POST', {
    personaAgentId: 'iris', responsibility: 'design_reviewer',
    submission: 'decision_request', summary: 'Which brand palette applies here?',
    decisionAction: 'clarification',
  })
  assert.equal(decision.response.status, 201)
  assert.ok(decision.json.decisionRequestId)

  const snapshot = await human(`/projects/${PROJECT_ID}`)
  const approval = snapshot.json.approvals.find((a: any) => a.id === decision.json.decisionRequestId)
  assert.ok(approval && approval.status === 'pending' && approval.action === 'clarification')
  assert.equal(snapshot.json.workItems[0].status, 'queued')
  assert.ok(snapshot.json.events.some((e: any) => e.kind === 'decision_request.opened'))
})
