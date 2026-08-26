import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  configureProjectAutonomy,
  createWorkItem,
  projectAutonomySnapshot,
  syncGitGovernance,
} from '../autonomy/coordinator.js'
import type { Planner } from '../autonomy/planner.js'
import { buildDefaultPlan } from '../autonomy/planner.js'
import { pool } from '../db/pool.js'
import {
  ensureSchemaOnce,
  resetAllTables,
  seedUserMembership,
  teardownAll,
} from './_helpers.js'

const USER_ID = 'u-planner-owner'
const COMPANY_ID = 'c-planner'
const PROJECT_ID = 'p-planner'
const CONVERSATION_ID = 'c-planner-project'

before(async () => { await ensureSchemaOnce() })
after(async () => { await teardownAll() })

async function seedAgent(id: string, name: string, departed = false) {
  await pool.query(
    `INSERT INTO participants (id,company_id,kind,name,role,initial,avatar_bg,status,departed_at)
     VALUES ($1,$2,'agent',$3,'engineer',$4,'#abcdef','avail',$5)
     ON CONFLICT DO NOTHING`,
    [id, COMPANY_ID, name, name.slice(0, 1).toUpperCase(), departed ? new Date() : null],
  )
}

beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO companies (id,name,slug,owner_user_id) VALUES ($1,'Planner Co','planner-co',$2)`,
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
  await seedAgent('bram', 'Bram')
  await seedAgent('ghost', 'Ghost', true)
  await syncGitGovernance({ companyId: COMPANY_ID, projectId: PROJECT_ID, actorId: USER_ID })
  await configureProjectAutonomy({
    companyId: COMPANY_ID, projectId: PROJECT_ID, actorId: USER_ID, mode: 'execute_with_gates',
    conversationId: CONVERSATION_ID,
  })
})

test('[integration] a work item gets an auditable plan the run references', async () => {
  const result = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID, goal: 'Fix duplicate conversations',
    createdBy: USER_ID, sourceType: 'manual', sourceKey: 'manual:plan-1',
  })
  assert.ok(result.runId)
  assert.ok(result.planId)
  assert.equal(result.blocked, undefined)

  const snapshot = await projectAutonomySnapshot(COMPANY_ID, PROJECT_ID) as any
  assert.equal(snapshot.plans.length, 1)
  const plan = snapshot.plans[0]
  assert.equal(plan.status, 'active')
  assert.deepEqual(plan.approvalNeeds, ['git.merge_master'])
  assert.equal(plan.responsibilities.length, 2)

  const run = await pool.query<{ planId: string | null }>(
    `SELECT plan_id AS "planId" FROM autonomy_runs WHERE id=$1`, [result.runId],
  )
  assert.equal(run.rows[0]?.planId, result.planId)
  assert.ok(snapshot.events.some((e: any) => e.kind === 'plan.created'))
})

test('[integration] retrying the same source reuses the work item and plan (no second planner attempt)', async () => {
  const first = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID, goal: 'Fix duplicate conversations',
    createdBy: USER_ID, sourceType: 'manual', sourceKey: 'manual:dedupe',
  })
  const second = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID, goal: 'Fix duplicate conversations',
    createdBy: USER_ID, sourceType: 'manual', sourceKey: 'manual:dedupe',
  })
  assert.equal(second.created, false)
  assert.equal(second.workItemId, first.workItemId)
  const plans = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM autonomy_plans WHERE work_item_id=$1`, [first.workItemId],
  )
  assert.equal(plans.rows[0]?.count, 1)
})

test('[integration] planner responsibilities bind a valid persona and never fabricate one', async () => {
  const planner: Planner = ({ goal, contract }) => ({
    ...buildDefaultPlan({ goal, contract }),
    responsibilities: [
      { role: 'builder_owner', preferredPersona: 'bram' },
      { role: 'independent_verifier', preferredPersona: 'ghost' }, // off-boarded → must stay unbound
      { role: 'design_reviewer', preferredPersona: 'nobody' },      // unknown → must stay unbound
    ],
  })
  const result = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID, goal: 'Redesign the login page',
    createdBy: USER_ID, sourceType: 'manual', sourceKey: 'manual:roles', planner,
  })
  assert.ok(result.runId)
  const snapshot = await projectAutonomySnapshot(COMPANY_ID, PROJECT_ID) as any
  const builder = snapshot.assignments.find((a: any) => a.responsibility === 'builder_owner')
  assert.ok(builder)
  assert.equal(builder.personaAgentId, 'bram')
  assert.equal(builder.personaName, 'Bram')
  assert.equal(builder.visibility, 'visible')
  // No fabricated bindings for the off-boarded / unknown personas.
  assert.ok(!snapshot.assignments.some((a: any) => a.personaAgentId === 'ghost'))
  assert.ok(!snapshot.assignments.some((a: any) => a.personaAgentId === 'nobody'))
})

test('[integration] a plan requesting a denied action opens a decision request instead of a run', async () => {
  const planner: Planner = ({ goal, contract }) => ({
    ...buildDefaultPlan({ goal, contract }),
    approvalNeeds: ['database.destructive_migration'], // deny in the Cumora contract
  })
  const result = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID, goal: 'Wipe the messages table',
    createdBy: USER_ID, sourceType: 'manual', sourceKey: 'manual:danger', planner,
  })
  assert.equal(result.blocked, true)
  assert.equal(result.runId, null)
  assert.ok(result.decisionRequestId)

  const runs = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM autonomy_runs WHERE work_item_id=$1`, [result.workItemId],
  )
  assert.equal(runs.rows[0]?.count, 0)

  const workItem = await pool.query<{ status: string }>(
    `SELECT status FROM autonomy_work_items WHERE id=$1`, [result.workItemId],
  )
  assert.equal(workItem.rows[0]?.status, 'blocked')

  const plan = await pool.query<{ status: string }>(
    `SELECT status FROM autonomy_plans WHERE work_item_id=$1`, [result.workItemId],
  )
  assert.equal(plan.rows[0]?.status, 'blocked')

  const approval = await pool.query<{ action: string; status: string }>(
    `SELECT action,status FROM autonomy_approvals WHERE id=$1`, [result.decisionRequestId],
  )
  assert.equal(approval.rows[0]?.action, 'database.destructive_migration')
  assert.equal(approval.rows[0]?.status, 'pending')

  const snapshot = await projectAutonomySnapshot(COMPANY_ID, PROJECT_ID) as any
  assert.ok(snapshot.events.some((e: any) => e.kind === 'decision_request.opened'))
})
