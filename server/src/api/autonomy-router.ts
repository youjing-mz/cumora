import { type Request, Router } from 'express'
import { resolveDevice } from '../agents/computer/registry.js'
import {
  assignRunResponsibility,
  AutonomyError,
  claimNextRun,
  completeAutonomyRun,
  configureProjectAutonomy,
  createWorkItem,
  decideApproval,
  heartbeatRun,
  parseResponsibility,
  preflightRun,
  projectAutonomySnapshot,
  recordMergedWorkItem,
  setComputerCapabilities,
  syncGitGovernance,
} from '../autonomy/coordinator.js'

interface Tenant {
  userId: string
  companyId: string
}

interface RouterDeps {
  requireCompany(req: Request): Promise<Tenant>
  requireCompanyRole(req: Request): Promise<Tenant & { role: string }>
}

function requiredText(value: unknown, name: string, max = 10_000): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new AutonomyError(400, `${name} required`)
  return text.slice(0, max)
}

function bearer(req: Request): string {
  const value = req.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

async function device(req: Request): Promise<{ computerId: string; companyId: string }> {
  const resolved = await resolveDevice(bearer(req))
  if (!resolved) throw new AutonomyError(401, 'invalid or revoked device token')
  return resolved
}

function handleError(res: import('express').Response, error: unknown): void {
  if (error instanceof AutonomyError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  console.error('[autonomy] request failed', error)
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
}

export function createAutonomyRouter(deps: RouterDeps): Router {
  const router = Router()

  router.get('/projects/:projectId', async (req, res) => {
    try {
      const { companyId } = await deps.requireCompany(req)
      res.json(await projectAutonomySnapshot(companyId, req.params.projectId))
    } catch (error) { handleError(res, error) }
  })

  router.post('/projects/:projectId/sync-git', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompanyRole(req)
      const result = await syncGitGovernance({
        companyId,
        projectId: req.params.projectId,
        actorId: userId,
        revision: typeof req.body?.revision === 'string' ? req.body.revision : undefined,
      })
      res.status(201).json(result)
    } catch (error) { handleError(res, error) }
  })

  router.post('/projects/:projectId/configure', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompanyRole(req)
      const mode = req.body?.mode
      if (!['observe', 'propose', 'execute_safe', 'execute_with_gates'].includes(mode)) {
        throw new AutonomyError(400, 'invalid autonomy mode')
      }
      await configureProjectAutonomy({
        companyId,
        projectId: req.params.projectId,
        actorId: userId,
        mode,
        conversationId: typeof req.body?.conversationId === 'string' ? req.body.conversationId : null,
        computerId: typeof req.body?.computerId === 'string' ? req.body.computerId : null,
        paused: req.body?.paused === true,
        pauseReason: typeof req.body?.pauseReason === 'string' ? req.body.pauseReason : null,
      })
      res.json({ ok: true })
    } catch (error) { handleError(res, error) }
  })

  router.post('/projects/:projectId/work-items', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompany(req)
      const result = await createWorkItem({
        companyId,
        projectId: req.params.projectId,
        goal: requiredText(req.body?.goal, 'goal'),
        createdBy: userId,
        sourceType: 'manual',
        sourceKey: typeof req.body?.idempotencyKey === 'string' ? `manual:${req.body.idempotencyKey}` : null,
        priority: req.body?.priority,
        riskLevel: req.body?.riskLevel,
      })
      res.status(result.created ? 201 : 200).json(result)
    } catch (error) { handleError(res, error) }
  })

  // Bind a Persona (visible responsibility) or an explicit executor to a Run.
  // The Control Plane already recorded the executor at claim time; this names
  // who is accountable. Owner/admin only — it is a control-plane decision.
  router.post('/projects/:projectId/runs/:runId/assignments', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompanyRole(req)
      const result = await assignRunResponsibility({
        companyId,
        projectId: req.params.projectId,
        runId: req.params.runId,
        actorId: userId,
        responsibility: parseResponsibility(req.body?.responsibility),
        personaAgentId: typeof req.body?.personaAgentId === 'string' ? req.body.personaAgentId : null,
        computerId: typeof req.body?.computerId === 'string' ? req.body.computerId : null,
        visibility: req.body?.visibility === 'internal' ? 'internal' : undefined,
      })
      res.status(result.created ? 201 : 200).json(result)
    } catch (error) { handleError(res, error) }
  })

  router.post('/approvals/:approvalId/decision', async (req, res) => {
    try {
      const { companyId, userId, role } = await deps.requireCompanyRole(req)
      if (!['approved', 'rejected'].includes(req.body?.decision)) {
        throw new AutonomyError(400, 'decision must be approved or rejected')
      }
      res.json(await decideApproval({
        companyId,
        approvalId: req.params.approvalId,
        actorId: userId,
        actorRole: role,
        decision: req.body.decision,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      }))
    } catch (error) { handleError(res, error) }
  })

  // Manual fallback for Git providers without a webhook adapter. GitHub uses
  // the signed webhook path and does not require this extra human action.
  router.post('/work-items/:workItemId/merged', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompanyRole(req)
      res.json(await recordMergedWorkItem({
        companyId,
        workItemId: req.params.workItemId,
        actorId: userId,
        commitSha: requiredText(req.body?.commitSha, 'commitSha', 100),
        pullRequestUrl: typeof req.body?.pullRequestUrl === 'string' ? req.body.pullRequestUrl : null,
      }))
    } catch (error) { handleError(res, error) }
  })

  // Node-facing coding-job queue. Device credentials identify the company and
  // computer; request bodies cannot override either identity.
  router.post('/jobs/claim', async (req, res) => {
    try {
      const resolved = await device(req)
      const job = await claimNextRun(resolved)
      if (!job) { res.status(204).end(); return }
      res.json(job)
    } catch (error) { handleError(res, error) }
  })

  // Register a Computer's scheduling capabilities + concurrency cap (Phase 3).
  router.post('/computers/:computerId/capabilities', async (req, res) => {
    try {
      const { companyId, userId } = await deps.requireCompanyRole(req)
      if (!Array.isArray(req.body?.capabilities)) throw new AutonomyError(400, 'capabilities array required')
      const result = await setComputerCapabilities({
        companyId,
        computerId: req.params.computerId,
        actorId: userId,
        capabilities: req.body.capabilities,
        maxConcurrentJobs: typeof req.body?.maxConcurrentJobs === 'number' ? req.body.maxConcurrentJobs : null,
      })
      res.json(result)
    } catch (error) { handleError(res, error) }
  })

  // Fencing preflight — the node calls this before any external side effect.
  router.post('/jobs/:runId/preflight', async (req, res) => {
    try {
      const resolved = await device(req)
      const result = await preflightRun({
        ...resolved,
        runId: req.params.runId,
        leaseToken: requiredText(req.body?.leaseToken, 'leaseToken', 100),
      })
      res.json({ ok: true, ...result })
    } catch (error) { handleError(res, error) }
  })

  router.post('/jobs/:runId/heartbeat', async (req, res) => {
    try {
      const resolved = await device(req)
      const leaseExpiresAt = await heartbeatRun({
        ...resolved,
        runId: req.params.runId,
        leaseToken: requiredText(req.body?.leaseToken, 'leaseToken', 100),
      })
      res.json({ ok: true, leaseExpiresAt })
    } catch (error) { handleError(res, error) }
  })

  router.post('/jobs/:runId/complete', async (req, res) => {
    try {
      const resolved = await device(req)
      if (!['ready_for_merge', 'completed', 'blocked', 'failed'].includes(req.body?.outcome)) {
        throw new AutonomyError(400, 'invalid outcome')
      }
      if (!Array.isArray(req.body?.evidence)) throw new AutonomyError(400, 'evidence array required')
      res.json(await completeAutonomyRun({
        ...resolved,
        runId: req.params.runId,
        leaseToken: requiredText(req.body?.leaseToken, 'leaseToken', 100),
        outcome: req.body.outcome,
        builderId: requiredText(req.body?.builderId, 'builderId', 200),
        summary: requiredText(req.body?.summary, 'summary'),
        evidence: req.body.evidence,
      }))
    } catch (error) { handleError(res, error) }
  })

  return router
}
