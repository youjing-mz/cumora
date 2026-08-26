/**
 * Dev helper: seed a rich autonomy Work Item so the Autonomy view (Phase 5)
 * has something to project. Idempotent-ish (reuses the work item on re-run via
 * the source key). Targets an existing company that already has agents.
 *
 *   COMPANY_ID=personal tsx scripts/seed-autonomy-demo.ts
 *
 * It uses the real Control Plane paths (governance, plan, assignments, reviews)
 * plus a couple of direct inserts for the execution binding and merge approval
 * that would otherwise require a paired node — this is demo data, not prod.
 */
import { pool } from '../server/src/db/pool.js'
import {
  assignRunResponsibility,
  configureProjectAutonomy,
  createWorkItem,
  submitPersonaReview,
  syncGitGovernance,
} from '../server/src/autonomy/coordinator.js'

const COMPANY_ID = process.env.COMPANY_ID ?? 'personal'
const PROJECT_ID = 'p-autonomy-demo'

async function main() {
  const company = await pool.query(`SELECT owner_user_id AS owner FROM companies WHERE id=$1`, [COMPANY_ID])
  if (!company.rows[0]) throw new Error(`company ${COMPANY_ID} not found`)
  const actorId: string = company.rows[0].owner ?? 'yetone'

  const agents = await pool.query<{ id: string }>(
    `SELECT id FROM participants WHERE company_id=$1 AND kind='agent' AND departed_at IS NULL ORDER BY id LIMIT 4`,
    [COMPANY_ID],
  )
  if (agents.rows.length < 3) throw new Error('need at least 3 agents in the company')
  const [builder, verifier, reviewer, planner] = [
    agents.rows[0].id, agents.rows[1].id, agents.rows[2].id, agents.rows[3]?.id ?? agents.rows[0].id,
  ]

  await pool.query(
    `INSERT INTO projects (id,company_id,name,description) VALUES ($1,$2,'Cumora','Self-hosting autonomy demo')
     ON CONFLICT (id) DO NOTHING`,
    [PROJECT_ID, COMPANY_ID],
  )
  await syncGitGovernance({ companyId: COMPANY_ID, projectId: PROJECT_ID, actorId, revision: 'demo-seed' })
  await configureProjectAutonomy({ companyId: COMPANY_ID, projectId: PROJECT_ID, actorId, mode: 'execute_with_gates' })

  const { workItemId, runId } = await createWorkItem({
    companyId: COMPANY_ID, projectId: PROJECT_ID,
    goal: 'Fix duplicate conversations from rapid double-clicks',
    createdBy: actorId, sourceType: 'manual', sourceKey: 'autonomy-demo-1',
  })
  if (!runId) throw new Error('work item did not create a run')

  // Responsible Personas.
  await assignRunResponsibility({ companyId: COMPANY_ID, projectId: PROJECT_ID, runId, actorId, responsibility: 'builder_owner', personaAgentId: builder })
  await assignRunResponsibility({ companyId: COMPANY_ID, projectId: PROJECT_ID, runId, actorId, responsibility: 'design_reviewer', personaAgentId: reviewer })
  await assignRunResponsibility({ companyId: COMPANY_ID, projectId: PROJECT_ID, runId, actorId, responsibility: 'independent_verifier', personaAgentId: verifier })
  if (planner !== builder) {
    await assignRunResponsibility({ companyId: COMPANY_ID, projectId: PROJECT_ID, runId, actorId, responsibility: 'planner', personaAgentId: planner })
  }

  // Execution binding on the builder_owner row (would come from a real claim).
  await pool.query(
    `UPDATE autonomy_run_assignments
        SET worker_id='codex-builder-17', computer_id='macbook-pro', engine='codex', updated_at=NOW()
      WHERE run_id=$1 AND responsibility='builder_owner'`,
    [runId],
  )
  await pool.query(
    `INSERT INTO autonomy_events (id,company_id,project_id,work_item_id,run_id,actor_id,kind,data)
     VALUES ('ae-demo-lease',$1,$2,$3,$4,'macbook-pro','run.leased','{"attempt":1,"computerId":"macbook-pro"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID, PROJECT_ID, workItemId, runId],
  )

  // Persona reviews (server-verified producers).
  await submitPersonaReview({
    companyId: COMPANY_ID, runId, actorId, personaAgentId: reviewer, responsibility: 'design_reviewer',
    submission: 'review_evidence', verdict: 'passed', summary: 'Spacing and contrast pass on the conversation list.',
  })
  await submitPersonaReview({
    companyId: COMPANY_ID, runId, actorId, personaAgentId: verifier, responsibility: 'independent_verifier',
    submission: 'review_evidence', verdict: 'passed', summary: 'Diff is focused; concurrency regression is covered.',
  })

  // Merge approval + awaiting_merge status (would come from a completed run).
  await pool.query(
    `INSERT INTO autonomy_approvals
       (id,company_id,project_id,work_item_id,run_id,action,required_role,status,reason,requested_by)
     VALUES ('aap-demo',$1,$2,$3,$4,'git.merge_master','project_owner','pending','Protected-branch merge requires a human decision.',$5)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID, PROJECT_ID, workItemId, runId, actorId],
  )
  await pool.query(`UPDATE autonomy_work_items SET status='awaiting_merge',updated_at=NOW() WHERE id=$1`, [workItemId])

  console.log(`[seed-autonomy-demo] company=${COMPANY_ID} project=${PROJECT_ID} workItem=${workItemId} run=${runId}`)
  console.log(`[seed-autonomy-demo] personas: builder=${builder} verifier=${verifier} reviewer=${reviewer} planner=${planner}`)
  await pool.end()
}

main().catch((error) => { console.error(error); process.exit(1) })
