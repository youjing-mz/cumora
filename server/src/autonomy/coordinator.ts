import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import {
  canonicalJson,
  compileJobEnvelope,
  decideAction,
  type JobEnvelope,
  loadProjectGovernance,
  type ProjectOperatingContract,
  sha256,
} from './contract.js'

type Json = Record<string, unknown>

export class AutonomyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function sourceRevision(): string | null {
  return process.env.CUMORA_SOURCE_REVISION?.trim() || process.env.GIT_SHA?.trim() || null
}

async function appendEvent(input: {
  companyId: string
  projectId: string
  workItemId?: string | null
  runId?: string | null
  actorId?: string | null
  kind: string
  data?: Json
}, db: { query: typeof pool.query } = pool): Promise<void> {
  await db.query(
    `INSERT INTO autonomy_events
       (id,company_id,project_id,work_item_id,run_id,actor_id,kind,data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [id('ae'), input.companyId, input.projectId, input.workItemId ?? null,
      input.runId ?? null, input.actorId ?? null, input.kind, JSON.stringify(input.data ?? {})],
  )
}

export async function syncGitGovernance(input: {
  companyId: string
  projectId: string
  actorId: string
  sourceRoot?: string
  revision?: string | null
}): Promise<{ visionVersionId: string; contractVersionId: string; effectiveHash: string; version: number }> {
  const governance = await loadProjectGovernance(input.sourceRoot)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: projects } = await client.query<{ id: string }>(
      `SELECT id FROM projects WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [input.projectId, input.companyId],
    )
    if (!projects[0]) throw new AutonomyError(404, 'project not found')

    const revision = input.revision ?? sourceRevision()
    const visionVersionId = `pgv-vision-${sha256(`${input.projectId}:${governance.visionHash}`).slice(0, 24)}`
    const contractVersionId = `pgv-contract-${sha256(`${input.projectId}:${governance.contractHash}`).slice(0, 24)}`

    await client.query(
      `UPDATE project_governance_versions
          SET status='superseded'
        WHERE project_id=$1 AND kind IN ('vision','contract') AND status='active'
          AND id <> ALL($2::text[])`,
      [input.projectId, [visionVersionId, contractVersionId]],
    )
    await client.query(
      `INSERT INTO project_governance_versions
         (id,company_id,project_id,kind,version,content,content_hash,effective_hash,
          source_path,source_revision,status,proposed_by,approved_by)
       VALUES ($1,$2,$3,'vision',$4,$5::jsonb,$6,$7,'.cumora/vision.md',$8,'active',$9,$9)
       ON CONFLICT (project_id,kind,content_hash) DO UPDATE
         SET status='active', approved_by=EXCLUDED.approved_by, activated_at=NOW(),
             source_revision=COALESCE(EXCLUDED.source_revision,project_governance_versions.source_revision)`,
      [visionVersionId, input.companyId, input.projectId, governance.contract.metadata.version,
        JSON.stringify({ markdown: governance.vision }), governance.visionHash,
        governance.effectiveHash, revision, input.actorId],
    )
    await client.query(
      `INSERT INTO project_governance_versions
         (id,company_id,project_id,kind,version,content,content_hash,effective_hash,
          source_path,source_revision,status,proposed_by,approved_by)
       VALUES ($1,$2,$3,'contract',$4,$5::jsonb,$6,$7,'.cumora/contract.yaml',$8,'active',$9,$9)
       ON CONFLICT (project_id,kind,content_hash) DO UPDATE
         SET status='active', approved_by=EXCLUDED.approved_by, activated_at=NOW(),
             source_revision=COALESCE(EXCLUDED.source_revision,project_governance_versions.source_revision)`,
      [contractVersionId, input.companyId, input.projectId, governance.contract.metadata.version,
        JSON.stringify(governance.contract), governance.contractHash,
        governance.effectiveHash, revision, input.actorId],
    )
    await client.query(
      `UPDATE projects
          SET active_vision_version_id=$1, active_contract_version_id=$2
        WHERE id=$3 AND company_id=$4`,
      [visionVersionId, contractVersionId, input.projectId, input.companyId],
    )
    await appendEvent({
      companyId: input.companyId,
      projectId: input.projectId,
      actorId: input.actorId,
      kind: 'governance.activated',
      data: {
        version: governance.contract.metadata.version,
        visionHash: governance.visionHash,
        contractHash: governance.contractHash,
        effectiveHash: governance.effectiveHash,
        revision,
      },
    }, client as never)
    await client.query('COMMIT')
    return {
      visionVersionId,
      contractVersionId,
      effectiveHash: governance.effectiveHash,
      version: governance.contract.metadata.version,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function configureProjectAutonomy(input: {
  companyId: string
  projectId: string
  actorId: string
  mode: 'observe' | 'propose' | 'execute_safe' | 'execute_with_gates'
  conversationId?: string | null
  computerId?: string | null
  paused?: boolean
  pauseReason?: string | null
}): Promise<void> {
  if (input.conversationId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM conversations WHERE id=$1 AND company_id=$2 AND project_id=$3`,
      [input.conversationId, input.companyId, input.projectId],
    )
    if (!rows[0]) throw new AutonomyError(400, 'autonomy conversation must belong to the project')
  }
  if (input.computerId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM computers WHERE id=$1 AND company_id=$2 AND revoked_at IS NULL`,
      [input.computerId, input.companyId],
    )
    if (!rows[0]) throw new AutonomyError(400, 'autonomy computer is unknown or revoked')
  }
  const result = await pool.query(
    `UPDATE projects
        SET autonomy_mode=$1,
            autonomy_conversation_id=$2,
            autonomy_computer_id=$3,
            autonomy_paused_at=CASE WHEN $4::boolean THEN NOW() ELSE NULL END,
            autonomy_pause_reason=CASE WHEN $4::boolean THEN $5 ELSE NULL END
      WHERE id=$6 AND company_id=$7
      RETURNING id`,
    [input.mode, input.conversationId ?? null, input.computerId ?? null,
      input.paused ?? false, input.pauseReason ?? null, input.projectId, input.companyId],
  )
  if (!result.rows[0]) throw new AutonomyError(404, 'project not found')
  await appendEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorId: input.actorId,
    kind: input.paused ? 'project.paused' : 'project.configured',
    data: { mode: input.mode, conversationId: input.conversationId, computerId: input.computerId, reason: input.pauseReason },
  })
}

interface ActiveGovernanceRow {
  projectId: string
  autonomyMode: string
  autonomyComputerId: string | null
  visionVersionId: string
  contractVersionId: string
  visionContent: { markdown?: string }
  contractContent: ProjectOperatingContract
  contractHash: string
}

async function activeGovernance(projectId: string, companyId: string): Promise<ActiveGovernanceRow> {
  const { rows } = await pool.query<ActiveGovernanceRow>(
    `SELECT p.id AS "projectId", p.autonomy_mode AS "autonomyMode",
            p.autonomy_computer_id AS "autonomyComputerId",
            v.id AS "visionVersionId", c.id AS "contractVersionId",
            v.content AS "visionContent", c.content AS "contractContent",
            c.content_hash AS "contractHash"
       FROM projects p
       JOIN project_governance_versions v ON v.id=p.active_vision_version_id AND v.status='active'
       JOIN project_governance_versions c ON c.id=p.active_contract_version_id AND c.status='active'
      WHERE p.id=$1 AND p.company_id=$2 AND p.autonomy_paused_at IS NULL`,
    [projectId, companyId],
  )
  if (!rows[0]) throw new AutonomyError(409, 'project has no active Git governance snapshot or is paused')
  return rows[0]
}

export async function createWorkItem(input: {
  companyId: string
  projectId: string
  goal: string
  createdBy: string
  sourceType: 'message' | 'manual' | 'sensor' | 'readback'
  sourceKey?: string | null
  sourceMessageId?: string | null
  priority?: 'critical' | 'high' | 'medium' | 'low'
  riskLevel?: 'critical' | 'high' | 'medium' | 'low'
}): Promise<{ workItemId: string; runId: string; created: boolean }> {
  const goal = input.goal.trim()
  if (!goal) throw new AutonomyError(400, 'goal required')
  const governance = await activeGovernance(input.projectId, input.companyId)
  if (!['execute_safe', 'execute_with_gates'].includes(governance.autonomyMode)) {
    throw new AutonomyError(409, `project autonomy mode ${governance.autonomyMode} does not execute work`)
  }

  const workItemId = id('awi')
  const runId = id('arun')
  const shippingFeatureId = id('sf')
  const envelope = compileJobEnvelope({
    governance: {
      vision: governance.visionContent.markdown ?? '',
      contract: governance.contractContent,
      contractHash: governance.contractHash,
    },
    workItemId,
    runId,
    goal,
  })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.sourceKey) {
      const existing = await client.query<{ workItemId: string; runId: string }>(
        `SELECT w.id AS "workItemId", r.id AS "runId"
           FROM autonomy_work_items w
           JOIN autonomy_runs r ON r.work_item_id=w.id AND r.attempt=1 AND r.job_type='implementation'
          WHERE w.company_id=$1 AND w.project_id=$2 AND w.source_key=$3`,
        [input.companyId, input.projectId, input.sourceKey],
      )
      if (existing.rows[0]) {
        await client.query('COMMIT')
        return { ...existing.rows[0], created: false }
      }
    }
    const duplicateGoal = await client.query<{ workItemId: string; runId: string }>(
      `SELECT w.id AS "workItemId",r.id AS "runId"
         FROM autonomy_work_items w
         JOIN autonomy_runs r ON r.work_item_id=w.id AND r.job_type='implementation' AND r.attempt=1
        WHERE w.company_id=$1 AND w.project_id=$2
          AND LOWER(BTRIM(w.goal))=LOWER(BTRIM($3))
          AND w.status NOT IN ('completed','failed','cancelled')
          AND w.created_at > NOW()-($4::int*INTERVAL '1 hour')
        ORDER BY w.created_at DESC LIMIT 1`,
      [input.companyId, input.projectId, goal, governance.contractContent.intake.deduplicationWindowHours],
    )
    if (duplicateGoal.rows[0]) {
      await client.query('COMMIT')
      return { ...duplicateGoal.rows[0], created: false }
    }

    await client.query(
      `INSERT INTO shipping_features
         (id,company_id,project_id,title,problem,desired_outcome,contract_summary,status,
          priority,risk_level,builder_ids,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6,'building',$7,$8,'[]'::jsonb,$9,$9)`,
      [shippingFeatureId, input.companyId, input.projectId, goal.slice(0, 160),
        `The goal is satisfied with contract-required evidence and is ready for protected-branch review.`,
        `Git governance ${governance.contractHash}; run ${runId}`,
        input.priority ?? 'medium', input.riskLevel ?? 'medium', input.createdBy],
    )
    await client.query(
      `INSERT INTO autonomy_work_items
         (id,company_id,project_id,source_type,source_key,source_message_id,goal,status,
          priority,risk_level,shipping_feature_id,created_by,assigned_computer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$12)`,
      [workItemId, input.companyId, input.projectId, input.sourceType, input.sourceKey ?? null,
        input.sourceMessageId ?? null, goal, input.priority ?? 'medium', input.riskLevel ?? 'medium',
        shippingFeatureId, input.createdBy, governance.autonomyComputerId],
    )
    await client.query(
      `INSERT INTO autonomy_runs
         (id,company_id,project_id,work_item_id,job_type,status,attempt,vision_version_id,
          contract_version_id,contract_hash,job_envelope,assigned_computer_id)
       VALUES ($1,$2,$3,$4,'implementation','queued',1,$5,$6,$7,$8::jsonb,$9)`,
      [runId, input.companyId, input.projectId, workItemId, governance.visionVersionId,
        governance.contractVersionId, governance.contractHash, JSON.stringify(envelope), governance.autonomyComputerId],
    )
    const shippingEvidenceKinds = envelope.requiredEvidence.filter((kind) =>
      ['required_checks', 'independent_verification', 'staging_smoke'].includes(kind),
    )
    for (const [position, kind] of shippingEvidenceKinds.entries()) {
      await client.query(
        `INSERT INTO shipping_verifications
           (id,feature_id,title,description,method,required,status,builder_ids,position,created_by)
         VALUES ($1,$2,$3,$3,$4,TRUE,'pending','[]'::jsonb,$5,$6)`,
        [id('sv'), shippingFeatureId, kind,
          kind === 'independent_verification' ? 'user_path' : kind === 'required_checks' ? 'property' : 'trace',
          position, input.createdBy],
      )
    }
    await appendEvent({
      companyId: input.companyId,
      projectId: input.projectId,
      workItemId,
      runId,
      actorId: input.createdBy,
      kind: 'work_item.created',
      data: { goal, sourceType: input.sourceType, sourceKey: input.sourceKey, contractHash: governance.contractHash },
    }, client as never)
    await client.query('COMMIT')
    return { workItemId, runId, created: true }
  } catch (error) {
    await client.query('ROLLBACK')
    if ((error as { code?: string }).code === '23505' && input.sourceKey) {
      const { rows } = await pool.query<{ workItemId: string; runId: string }>(
        `SELECT w.id AS "workItemId", r.id AS "runId"
           FROM autonomy_work_items w JOIN autonomy_runs r ON r.work_item_id=w.id
          WHERE w.company_id=$1 AND w.project_id=$2 AND w.source_key=$3 LIMIT 1`,
        [input.companyId, input.projectId, input.sourceKey],
      )
      if (rows[0]) return { ...rows[0], created: false }
    }
    throw error
  } finally {
    client.release()
  }
}

export async function intakeProjectMessage(input: {
  companyId: string
  conversationId: string
  messageId: string
  authorId: string
  body: string
}): Promise<{ workItemId: string; runId: string; created: boolean } | null> {
  const { rows } = await pool.query<{ projectId: string }>(
    `SELECT p.id AS "projectId"
       FROM conversations c
       JOIN projects p ON p.id=c.project_id AND p.company_id=c.company_id
      WHERE c.id=$1 AND c.company_id=$2
        AND p.autonomy_conversation_id=c.id
        AND p.autonomy_mode IN ('execute_safe','execute_with_gates')
        AND p.autonomy_paused_at IS NULL`,
    [input.conversationId, input.companyId],
  )
  if (!rows[0]) return null
  return createWorkItem({
    companyId: input.companyId,
    projectId: rows[0].projectId,
    goal: input.body,
    createdBy: input.authorId,
    sourceType: 'message',
    sourceKey: `message:${input.messageId}`,
    sourceMessageId: input.messageId,
  })
}

export async function claimNextRun(input: {
  companyId: string
  computerId: string
}): Promise<{ runId: string; leaseToken: string; leaseExpiresAt: string; envelope: JobEnvelope } | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE autonomy_runs
          SET status='queued', lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
        WHERE company_id=$1 AND status IN ('leased','running') AND lease_expires_at < NOW()`,
      [input.companyId],
    )
    const { rows } = await client.query<{
      id: string
      envelope: JobEnvelope
      leaseMinutes: number
      workItemId: string
      projectId: string
    }>(
      `SELECT r.id, r.job_envelope AS envelope, r.work_item_id AS "workItemId",
              r.project_id AS "projectId",
              COALESCE((g.content->'runtime'->>'leaseMinutes')::int,10) AS "leaseMinutes"
         FROM autonomy_runs r
         JOIN project_governance_versions g ON g.id=r.contract_version_id
        WHERE r.company_id=$1 AND r.status='queued'
          AND (r.assigned_computer_id IS NULL OR r.assigned_computer_id=$2)
        ORDER BY r.created_at ASC
        FOR UPDATE OF r SKIP LOCKED
        LIMIT 1`,
      [input.companyId, input.computerId],
    )
    const row = rows[0]
    if (!row) {
      await client.query('COMMIT')
      return null
    }
    const leaseToken = randomUUID()
    const leased = await client.query<{ leaseExpiresAt: string }>(
      `UPDATE autonomy_runs
          SET status='leased', lease_token=$1,
              lease_expires_at=NOW()+($2::int*INTERVAL '1 minute'), updated_at=NOW()
        WHERE id=$3
        RETURNING lease_expires_at AS "leaseExpiresAt"`,
      [leaseToken, row.leaseMinutes, row.id],
    )
    await client.query(
      `UPDATE autonomy_work_items SET status='running',updated_at=NOW() WHERE id=$1`,
      [row.workItemId],
    )
    await appendEvent({
      companyId: input.companyId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      runId: row.id,
      actorId: input.computerId,
      kind: 'run.leased',
      data: { computerId: input.computerId, leaseExpiresAt: leased.rows[0]?.leaseExpiresAt },
    }, client as never)
    await client.query('COMMIT')
    return {
      runId: row.id,
      leaseToken,
      leaseExpiresAt: leased.rows[0]?.leaseExpiresAt,
      envelope: row.envelope,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function heartbeatRun(input: {
  companyId: string
  computerId: string
  runId: string
  leaseToken: string
}): Promise<string> {
  const { rows } = await pool.query<{ leaseExpiresAt: string }>(
    `UPDATE autonomy_runs r
        SET status='running', started_at=COALESCE(started_at,NOW()),
            lease_expires_at=NOW()+(
              SELECT COALESCE((g.content->'runtime'->>'leaseMinutes')::int,10)*INTERVAL '1 minute'
                FROM project_governance_versions g WHERE g.id=r.contract_version_id
            ), updated_at=NOW()
      WHERE r.id=$1 AND r.company_id=$2 AND r.lease_token=$3
        AND (r.assigned_computer_id IS NULL OR r.assigned_computer_id=$4)
        AND r.lease_expires_at > NOW()
      RETURNING r.lease_expires_at AS "leaseExpiresAt"`,
    [input.runId, input.companyId, input.leaseToken, input.computerId],
  )
  if (!rows[0]) throw new AutonomyError(409, 'run lease is stale or belongs to another worker')
  return rows[0].leaseExpiresAt
}

export interface SubmittedEvidence {
  kind: string
  status?: 'passed' | 'failed' | 'informational'
  producerId?: string | null
  payload: Json
}

export async function completeImplementationRun(input: {
  companyId: string
  computerId: string
  runId: string
  leaseToken: string
  outcome: 'ready_for_merge' | 'blocked' | 'failed'
  builderId: string
  summary: string
  evidence: SubmittedEvidence[]
}): Promise<{ status: string; missingEvidence: string[]; approvalId?: string }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{
      workItemId: string
      projectId: string
      featureId: string | null
      contract: ProjectOperatingContract
      envelope: JobEnvelope
    }>(
      `SELECT r.work_item_id AS "workItemId",r.project_id AS "projectId",
              w.shipping_feature_id AS "featureId",g.content AS contract,
              r.job_envelope AS envelope
         FROM autonomy_runs r
         JOIN autonomy_work_items w ON w.id=r.work_item_id
         JOIN project_governance_versions g ON g.id=r.contract_version_id
        WHERE r.id=$1 AND r.company_id=$2 AND r.lease_token=$3
          AND (r.assigned_computer_id IS NULL OR r.assigned_computer_id=$4)
          AND r.status IN ('leased','running','awaiting_evidence') AND r.lease_expires_at > NOW()
        FOR UPDATE OF r,w`,
      [input.runId, input.companyId, input.leaseToken, input.computerId],
    )
    const row = rows[0]
    if (!row) throw new AutonomyError(409, 'run lease is stale or run cannot be completed')

    const submittedIndependent = input.evidence.find((item) =>
      item.kind === 'independent_verification' && (item.status ?? 'passed') === 'passed',
    )
    if ((submittedIndependent?.producerId ?? input.builderId) === input.builderId && submittedIndependent) {
      throw new AutonomyError(409, 'builder cannot provide independent_verification evidence')
    }

    if (row.featureId) {
      const builders = JSON.stringify([input.builderId])
      await client.query(`UPDATE shipping_features SET builder_ids=$1::jsonb,updated_at=NOW() WHERE id=$2`, [builders, row.featureId])
      await client.query(`UPDATE shipping_verifications SET builder_ids=$1::jsonb,updated_at=NOW() WHERE feature_id=$2`, [builders, row.featureId])
    }

    for (const evidence of input.evidence) {
      const payloadText = canonicalJson(evidence.payload)
      await client.query(
        `INSERT INTO autonomy_evidence
           (id,company_id,work_item_id,run_id,kind,status,producer_id,payload,content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [id('aev'), input.companyId, row.workItemId, input.runId, evidence.kind,
          evidence.status ?? 'passed', evidence.producerId ?? input.builderId,
          payloadText, sha256(payloadText)],
      )
      if (row.featureId) {
        await client.query(
          `UPDATE shipping_verifications
              SET status=$1,evidence=evidence || $2::jsonb,verified_by_id=$3,
                  completed_at=CASE WHEN $1='passed' THEN NOW() ELSE completed_at END,updated_at=NOW()
            WHERE feature_id=$4 AND title=$5`,
          [evidence.status ?? 'passed', JSON.stringify([{ runId: input.runId, ...evidence.payload }]),
            evidence.producerId ?? input.builderId, row.featureId, evidence.kind],
        )
      }
    }

    if (input.outcome !== 'ready_for_merge') {
      const status = input.outcome === 'blocked' ? 'blocked' : 'failed'
      await client.query(
        `UPDATE autonomy_runs SET status=$1,result=$2::jsonb,error=$3,completed_at=NOW(),updated_at=NOW() WHERE id=$4`,
        [status, JSON.stringify({ summary: input.summary, builderId: input.builderId }), input.summary, input.runId],
      )
      await client.query(`UPDATE autonomy_work_items SET status=$1,updated_at=NOW() WHERE id=$2`, [status, row.workItemId])
      await appendEvent({
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        runId: input.runId, actorId: input.builderId, kind: `run.${status}`, data: { summary: input.summary },
      }, client as never)
      await client.query('COMMIT')
      return { status, missingEvidence: [] }
    }

    const mergePolicy = decideAction(row.contract, 'git.merge_master').policy
    const required = mergePolicy?.requiresEvidence ?? row.envelope.requiredEvidence
    const { rows: passed } = await client.query<{ kind: string; producerId: string | null }>(
      `SELECT kind,producer_id AS "producerId" FROM autonomy_evidence
        WHERE work_item_id=$1 AND status='passed'`,
      [row.workItemId],
    )
    const passedKinds = new Set(passed.map((item) => item.kind))
    const missingEvidence = required.filter((kind) => !passedKinds.has(kind))
    const independent = passed.find((item) => item.kind === 'independent_verification')
    if (independent?.producerId === input.builderId) {
      throw new AutonomyError(409, 'builder cannot provide independent_verification evidence')
    }
    if (missingEvidence.length > 0) {
      await client.query(
        `UPDATE autonomy_runs SET status='awaiting_evidence',result=$1::jsonb,updated_at=NOW() WHERE id=$2`,
        [JSON.stringify({ summary: input.summary, builderId: input.builderId, missingEvidence }), input.runId],
      )
      await client.query(`UPDATE autonomy_work_items SET status='verifying',updated_at=NOW() WHERE id=$1`, [row.workItemId])
      await appendEvent({
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        runId: input.runId, actorId: input.builderId, kind: 'run.evidence_missing', data: { missingEvidence },
      }, client as never)
      await client.query('COMMIT')
      return { status: 'verifying', missingEvidence }
    }

    const approvalId = id('aap')
    await client.query(
      `UPDATE autonomy_runs SET status='completed',result=$1::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$2`,
      [JSON.stringify({ summary: input.summary, builderId: input.builderId }), input.runId],
    )
    await client.query(`UPDATE autonomy_work_items SET status='awaiting_merge',updated_at=NOW() WHERE id=$1`, [row.workItemId])
    if (row.featureId) await client.query(`UPDATE shipping_features SET status='ready',updated_at=NOW() WHERE id=$1`, [row.featureId])
    await client.query(
      `INSERT INTO autonomy_approvals
         (id,company_id,project_id,work_item_id,run_id,action,required_role,status,reason,context,requested_by)
       VALUES ($1,$2,$3,$4,$5,'git.merge_master',$6,'pending',$7,$8::jsonb,$9)`,
      [approvalId, input.companyId, row.projectId, row.workItemId, input.runId,
        mergePolicy?.approvalRole ?? 'project_owner', mergePolicy?.reason ?? 'protected branch merge',
        JSON.stringify({ summary: input.summary, evidenceKinds: [...passedKinds], contractHash: row.envelope.contractHash }),
        input.builderId],
    )
    await appendEvent({
      companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
      runId: input.runId, actorId: input.builderId, kind: 'approval.requested',
      data: { approvalId, action: 'git.merge_master', evidenceKinds: [...passedKinds] },
    }, client as never)
    await client.query('COMMIT')
    return { status: 'awaiting_merge', missingEvidence: [], approvalId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function createFollowupRun(
  client: PoolClient,
  input: {
    companyId: string
    projectId: string
    workItemId: string
    jobType: 'deployment' | 'readback'
    goal: string
    visionVersionId: string
    contractVersionId: string
    contractHash: string
    baseEnvelope: JobEnvelope
    assignedComputerId: string | null
  },
): Promise<string> {
  const runId = id('arun')
  const envelope: JobEnvelope = {
    ...input.baseEnvelope,
    runId,
    jobType: input.jobType,
    goal: input.goal,
    requiredEvidence: input.jobType === 'deployment'
      ? ['merge_commit', 'staging_smoke', 'rollback_plan', 'production_deployment']
      : ['production_readback'],
  }
  await client.query(
    `INSERT INTO autonomy_runs
       (id,company_id,project_id,work_item_id,job_type,status,attempt,vision_version_id,
        contract_version_id,contract_hash,job_envelope,assigned_computer_id)
     VALUES ($1,$2,$3,$4,$5,'queued',1,$6,$7,$8,$9::jsonb,$10)`,
    [runId, input.companyId, input.projectId, input.workItemId, input.jobType,
      input.visionVersionId, input.contractVersionId, input.contractHash,
      JSON.stringify(envelope), input.assignedComputerId],
  )
  return runId
}

export async function recordMergedWorkItem(input: {
  companyId: string
  workItemId: string
  actorId: string
  commitSha: string
  pullRequestUrl?: string | null
}): Promise<{ deploymentRunId: string; status: 'releasing' }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{
      projectId: string
      featureId: string | null
      assignedComputerId: string | null
      implementationRunId: string
      visionVersionId: string
      contractVersionId: string
      contractHash: string
      envelope: JobEnvelope
      goal: string
    }>(
      `SELECT w.project_id AS "projectId",w.shipping_feature_id AS "featureId",
              w.assigned_computer_id AS "assignedComputerId",w.goal,
              r.id AS "implementationRunId",r.vision_version_id AS "visionVersionId",
              r.contract_version_id AS "contractVersionId",r.contract_hash AS "contractHash",
              r.job_envelope AS envelope
         FROM autonomy_work_items w
         JOIN autonomy_runs r ON r.work_item_id=w.id AND r.job_type='implementation' AND r.attempt=1
        WHERE w.id=$1 AND w.company_id=$2 AND w.status='approved_for_merge'
        FOR UPDATE OF w`,
      [input.workItemId, input.companyId],
    )
    const row = rows[0]
    if (!row) throw new AutonomyError(409, 'work item is not approved for merge')
    const payload = { commitSha: input.commitSha, pullRequestUrl: input.pullRequestUrl ?? null }
    const payloadText = canonicalJson(payload)
    await client.query(
      `INSERT INTO autonomy_evidence
         (id,company_id,work_item_id,run_id,kind,status,producer_id,payload,content_hash)
       VALUES ($1,$2,$3,$4,'merge_commit','passed',$5,$6::jsonb,$7)`,
      [id('aev'), input.companyId, input.workItemId, row.implementationRunId,
        input.actorId, payloadText, sha256(payloadText)],
    )
    const deploymentRunId = await createFollowupRun(client, {
      companyId: input.companyId,
      projectId: row.projectId,
      workItemId: input.workItemId,
      jobType: 'deployment',
      goal: `Deploy merged work item to production: ${row.goal}`,
      visionVersionId: row.visionVersionId,
      contractVersionId: row.contractVersionId,
      contractHash: row.contractHash,
      baseEnvelope: row.envelope,
      assignedComputerId: row.assignedComputerId,
    })
    await client.query(`UPDATE autonomy_work_items SET status='releasing',updated_at=NOW() WHERE id=$1`, [input.workItemId])
    if (row.featureId) {
      await client.query(`UPDATE shipping_features SET status='releasing',updated_at=NOW() WHERE id=$1`, [row.featureId])
    }
    await appendEvent({
      companyId: input.companyId, projectId: row.projectId, workItemId: input.workItemId,
      runId: deploymentRunId, actorId: input.actorId, kind: 'git.merged', data: payload,
    }, client as never)
    await client.query('COMMIT')
    return { deploymentRunId, status: 'releasing' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function recordMergedBranch(input: {
  repositoryUrl: string
  branch: string
  commitSha: string
  pullRequestUrl?: string | null
}): Promise<{ deploymentRunId: string; status: 'releasing' } | null> {
  const { rows } = await pool.query<{ companyId: string; workItemId: string }>(
    `SELECT w.company_id AS "companyId",w.id AS "workItemId"
       FROM autonomy_work_items w
       JOIN autonomy_runs r ON r.work_item_id=w.id AND r.job_type='implementation'
      WHERE w.status='approved_for_merge'
        AND r.job_envelope->>'branch'=$1
        AND r.job_envelope->'repository'->>'url'=$2
      ORDER BY w.created_at DESC LIMIT 1`,
    [input.branch, input.repositoryUrl],
  )
  if (!rows[0]) return null
  return recordMergedWorkItem({
    ...rows[0],
    actorId: 'github-webhook',
    commitSha: input.commitSha,
    pullRequestUrl: input.pullRequestUrl,
  })
}

export async function completeOperationalRun(input: {
  companyId: string
  computerId: string
  runId: string
  leaseToken: string
  outcome: 'completed' | 'blocked' | 'failed'
  builderId: string
  summary: string
  evidence: SubmittedEvidence[]
}): Promise<{ status: string; missingEvidence: string[]; nextRunId?: string }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{
      jobType: 'deployment' | 'readback'
      workItemId: string
      projectId: string
      goal: string
      featureId: string | null
      assignedComputerId: string | null
      visionVersionId: string
      contractVersionId: string
      contractHash: string
      envelope: JobEnvelope
    }>(
      `SELECT r.job_type AS "jobType",r.work_item_id AS "workItemId",r.project_id AS "projectId",
              r.vision_version_id AS "visionVersionId",r.contract_version_id AS "contractVersionId",
              r.contract_hash AS "contractHash",r.job_envelope AS envelope,w.goal,
              w.shipping_feature_id AS "featureId",w.assigned_computer_id AS "assignedComputerId"
         FROM autonomy_runs r JOIN autonomy_work_items w ON w.id=r.work_item_id
        WHERE r.id=$1 AND r.company_id=$2 AND r.lease_token=$3
          AND (r.assigned_computer_id IS NULL OR r.assigned_computer_id=$4)
          AND r.job_type IN ('deployment','readback')
          AND r.status IN ('leased','running','awaiting_evidence') AND r.lease_expires_at > NOW()
        FOR UPDATE OF r,w`,
      [input.runId, input.companyId, input.leaseToken, input.computerId],
    )
    const row = rows[0]
    if (!row) throw new AutonomyError(409, 'operational run lease is stale or run cannot be completed')
    for (const evidence of input.evidence) {
      const payloadText = canonicalJson(evidence.payload)
      await client.query(
        `INSERT INTO autonomy_evidence
           (id,company_id,work_item_id,run_id,kind,status,producer_id,payload,content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [id('aev'), input.companyId, row.workItemId, input.runId, evidence.kind,
          evidence.status ?? 'passed', evidence.producerId ?? input.builderId,
          payloadText, sha256(payloadText)],
      )
      if (row.featureId) {
        await client.query(
          `UPDATE shipping_verifications
              SET status=$1,evidence=evidence || $2::jsonb,verified_by_id=$3,
                  completed_at=CASE WHEN $1='passed' THEN NOW() ELSE completed_at END,updated_at=NOW()
            WHERE feature_id=$4 AND title=$5`,
          [evidence.status ?? 'passed', JSON.stringify([{ runId: input.runId, ...evidence.payload }]),
            evidence.producerId ?? input.builderId, row.featureId, evidence.kind],
        )
      }
    }
    if (input.outcome !== 'completed') {
      const status = input.outcome === 'blocked' ? 'blocked' : 'failed'
      await client.query(
        `UPDATE autonomy_runs SET status=$1,error=$2,result=$3::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$4`,
        [status, input.summary, JSON.stringify({ summary: input.summary }), input.runId],
      )
      await client.query(`UPDATE autonomy_work_items SET status=$1,updated_at=NOW() WHERE id=$2`, [status, row.workItemId])
      await appendEvent({
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        runId: input.runId, actorId: input.builderId, kind: `run.${status}`, data: { jobType: row.jobType, summary: input.summary },
      }, client as never)
      await client.query('COMMIT')
      return { status, missingEvidence: [] }
    }
    const { rows: evidenceRows } = await client.query<{ kind: string }>(
      `SELECT DISTINCT kind FROM autonomy_evidence WHERE work_item_id=$1 AND status='passed'`,
      [row.workItemId],
    )
    const passed = new Set(evidenceRows.map((item) => item.kind))
    const required = row.envelope.requiredEvidence
    const missingEvidence = required.filter((kind) => !passed.has(kind))
    if (missingEvidence.length > 0) {
      await client.query(
        `UPDATE autonomy_runs SET status='awaiting_evidence',result=$1::jsonb,updated_at=NOW() WHERE id=$2`,
        [JSON.stringify({ summary: input.summary, missingEvidence }), input.runId],
      )
      await appendEvent({
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        runId: input.runId, actorId: input.builderId, kind: 'run.evidence_missing', data: { missingEvidence, jobType: row.jobType },
      }, client as never)
      await client.query('COMMIT')
      return { status: 'awaiting_evidence', missingEvidence }
    }

    await client.query(
      `UPDATE autonomy_runs SET status='completed',result=$1::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$2`,
      [JSON.stringify({ summary: input.summary, builderId: input.builderId }), input.runId],
    )
    if (row.jobType === 'deployment') {
      const merge = await client.query<{ commitSha: string | null }>(
        `SELECT payload->>'commitSha' AS "commitSha" FROM autonomy_evidence
          WHERE work_item_id=$1 AND kind='merge_commit' ORDER BY created_at DESC LIMIT 1`,
        [row.workItemId],
      )
      if (row.featureId) {
        await client.query(
          `INSERT INTO shipping_releases
             (id,feature_id,environment,status,commit_sha,started_by,release_notes,rollback_plan,
              smoke_evidence,readback_due_at,readback_status,started_at,completed_at)
           VALUES ($1,$2,'production','succeeded',$3,$4,$5,$6,$7::jsonb,NOW()+INTERVAL '24 hours','pending',NOW(),NOW())`,
          [id('sr'), row.featureId, merge.rows[0]?.commitSha ?? null, input.builderId,
            input.summary, 'Revert to the prior known-good commit and redeploy.',
            JSON.stringify(input.evidence.map((item) => ({ kind: item.kind, ...item.payload })))],
        )
        await client.query(`UPDATE shipping_features SET status='watching',updated_at=NOW() WHERE id=$1`, [row.featureId])
      }
      const nextRunId = await createFollowupRun(client, {
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        jobType: 'readback', goal: `Read back production for: ${row.goal}`,
        visionVersionId: row.visionVersionId, contractVersionId: row.contractVersionId,
        contractHash: row.contractHash, baseEnvelope: row.envelope,
        assignedComputerId: row.assignedComputerId,
      })
      await client.query(`UPDATE autonomy_work_items SET status='watching',updated_at=NOW() WHERE id=$1`, [row.workItemId])
      await appendEvent({
        companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
        runId: input.runId, actorId: input.builderId, kind: 'deployment.succeeded', data: { nextRunId },
      }, client as never)
      await client.query('COMMIT')
      return { status: 'watching', missingEvidence: [], nextRunId }
    }

    await client.query(`UPDATE autonomy_work_items SET status='completed',completed_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.workItemId])
    if (row.featureId) {
      await client.query(`UPDATE shipping_features SET status='learned',updated_at=NOW() WHERE id=$1`, [row.featureId])
      await client.query(
        `UPDATE shipping_releases SET readback_status='passed',readback_evidence=$1::jsonb,updated_at=NOW()
          WHERE id=(SELECT id FROM shipping_releases WHERE feature_id=$2 AND environment='production' ORDER BY created_at DESC LIMIT 1)`,
        [JSON.stringify(input.evidence.map((item) => ({ kind: item.kind, ...item.payload }))), row.featureId],
      )
    }
    await appendEvent({
      companyId: input.companyId, projectId: row.projectId, workItemId: row.workItemId,
      runId: input.runId, actorId: input.builderId, kind: 'readback.passed', data: { summary: input.summary },
    }, client as never)
    await client.query('COMMIT')
    return { status: 'completed', missingEvidence: [] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function completeAutonomyRun(input: {
  companyId: string
  computerId: string
  runId: string
  leaseToken: string
  outcome: 'ready_for_merge' | 'completed' | 'blocked' | 'failed'
  builderId: string
  summary: string
  evidence: SubmittedEvidence[]
}): Promise<{ status: string; missingEvidence: string[]; approvalId?: string; nextRunId?: string }> {
  const { rows } = await pool.query<{ jobType: string }>(
    `SELECT job_type AS "jobType" FROM autonomy_runs WHERE id=$1 AND company_id=$2`,
    [input.runId, input.companyId],
  )
  if (!rows[0]) throw new AutonomyError(404, 'run not found')
  if (rows[0].jobType === 'implementation') {
    if (input.outcome === 'completed') throw new AutonomyError(400, 'implementation outcome must be ready_for_merge, blocked or failed')
    return completeImplementationRun({ ...input, outcome: input.outcome })
  }
  if (input.outcome === 'ready_for_merge') throw new AutonomyError(400, 'operational outcome must be completed, blocked or failed')
  return completeOperationalRun({ ...input, outcome: input.outcome })
}

export async function decideApproval(input: {
  companyId: string
  approvalId: string
  actorId: string
  actorRole: string
  decision: 'approved' | 'rejected'
  note?: string
}): Promise<{ workItemId: string | null; workItemStatus: string }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ projectId: string; workItemId: string | null; action: string; requiredRole: string }>(
      `UPDATE autonomy_approvals
          SET status=$1,decided_by=$2,decision_note=$3,decided_at=NOW()
        WHERE id=$4 AND company_id=$5 AND status='pending'
        RETURNING project_id AS "projectId",work_item_id AS "workItemId",action,required_role AS "requiredRole"`,
      [input.decision, input.actorId, input.note ?? null, input.approvalId, input.companyId],
    )
    const approval = rows[0]
    if (!approval) throw new AutonomyError(409, 'approval not found or already decided')
    const authorized = ['project_owner', 'release_owner'].includes(approval.requiredRole)
      ? ['owner', 'admin'].includes(input.actorRole)
      : input.actorRole === approval.requiredRole
    if (!authorized) throw new AutonomyError(403, `approval requires role ${approval.requiredRole}`)
    const workItemStatus = input.decision === 'approved' && approval.action === 'git.merge_master'
      ? 'approved_for_merge'
      : 'blocked'
    if (approval.workItemId) {
      await client.query(`UPDATE autonomy_work_items SET status=$1,updated_at=NOW() WHERE id=$2`, [workItemStatus, approval.workItemId])
    }
    await appendEvent({
      companyId: input.companyId, projectId: approval.projectId, workItemId: approval.workItemId,
      actorId: input.actorId, kind: `approval.${input.decision}`,
      data: { approvalId: input.approvalId, action: approval.action, note: input.note },
    }, client as never)
    await client.query('COMMIT')
    return { workItemId: approval.workItemId, workItemStatus }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function projectAutonomySnapshot(companyId: string, projectId: string): Promise<Json> {
  const { rows: projects } = await pool.query(
    `SELECT p.id,p.name,p.autonomy_mode AS "autonomyMode",
            p.autonomy_conversation_id AS "conversationId",p.autonomy_computer_id AS "computerId",
            p.autonomy_paused_at AS "pausedAt",p.autonomy_pause_reason AS "pauseReason",
            v.version AS "visionVersion",v.content_hash AS "visionHash",v.source_revision AS "visionRevision",
            c.version AS "contractVersion",c.content_hash AS "contractHash",c.source_revision AS "contractRevision"
       FROM projects p
       LEFT JOIN project_governance_versions v ON v.id=p.active_vision_version_id
       LEFT JOIN project_governance_versions c ON c.id=p.active_contract_version_id
      WHERE p.id=$1 AND p.company_id=$2`,
    [projectId, companyId],
  )
  if (!projects[0]) throw new AutonomyError(404, 'project not found')
  const [workItems, approvals, events] = await Promise.all([
    pool.query(
      `SELECT id,goal,status,priority,risk_level AS "riskLevel",shipping_feature_id AS "shippingFeatureId",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM autonomy_work_items WHERE project_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [projectId, companyId],
    ),
    pool.query(
      `SELECT id,work_item_id AS "workItemId",action,required_role AS "requiredRole",status,reason,
              context,created_at AS "createdAt",decided_at AS "decidedAt"
         FROM autonomy_approvals WHERE project_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [projectId, companyId],
    ),
    pool.query(
      `SELECT id,work_item_id AS "workItemId",run_id AS "runId",actor_id AS "actorId",kind,data,
              created_at AS "createdAt"
         FROM autonomy_events WHERE project_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 200`,
      [projectId, companyId],
    ),
  ])
  return { project: projects[0], workItems: workItems.rows, approvals: approvals.rows, events: events.rows }
}
