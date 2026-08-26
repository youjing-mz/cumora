/**
 * Phase 2 of the four-layer agent architecture (see
 * docs/en/agent-mechanisms/08-agent-architecture-iteration-plan.md).
 *
 * The Planner turns a raw goal into a structured, auditable plan BEFORE any
 * implementation Run is created: the problem, acceptance criteria, required
 * capabilities, the responsibilities that need an owner, and the actions that
 * will need human approval. Making this explicit means Persona division-of-
 * labor is a recorded decision rather than something implied inside a prompt.
 *
 * This module is deterministic and dependency-light on purpose: the default
 * planner needs no model, so the whole loop (including `npm run test:e2e`)
 * runs locally without OpenAI. A model-assisted planner can later implement
 * the same `Planner` signature; the Policy Engine still validates its output.
 */
import { decideAction, type PolicyDecision, type ProjectOperatingContract, canonicalJson, sha256 } from './contract.js'
import type { RunResponsibility } from './responsibilities.js'

export interface PlanResponsibility {
  role: RunResponsibility
  /** A Persona the planner prefers for this responsibility. The coordinator
   *  only binds it when it resolves to an active agent — the planner must not
   *  fabricate a roster member. */
  preferredPersona?: string | null
  /** Optional condition, e.g. `ui_changed`, for reviewers that only apply
   *  sometimes. Advisory in Phase 2. */
  when?: string
}

export interface RunPlan {
  problem: string
  desiredOutcome: string
  acceptanceCriteria: string[]
  risk: 'critical' | 'high' | 'medium' | 'low'
  requiredCapabilities: string[]
  responsibilities: PlanResponsibility[]
  approvalNeeds: string[]
}

export type Planner = (input: { goal: string; contract: ProjectOperatingContract }) => RunPlan

/**
 * Deterministic default planner. Derives everything from the goal and the
 * activated contract — no model call — so a plan always exists and the loop is
 * reproducible. Responsibilities are left unbound (no `preferredPersona`): the
 * default planner never invents a Persona; a human/planner can bind owners via
 * the Phase 1 assignment endpoint or a smarter planner can suggest them.
 */
export const buildDefaultPlan: Planner = ({ goal, contract }) => {
  const requiredChecks = contract.verification.requiredBeforeMerge
  const capabilities = ['repo:read', 'repo:write', contract.runtime.runner]
  if (contract.actions['deploy.staging']?.effect === 'allow') capabilities.push('staging:deploy')

  // Only the protected-branch merge approval is relevant to a code change.
  // Governance-activation approvals exist in the contract but are not requested
  // by an implementation plan, so the deterministic default stays focused.
  const approvalNeeds = contract.actions['git.merge_master']?.effect === 'require_approval'
    ? ['git.merge_master']
    : []

  return {
    problem: goal,
    desiredOutcome: `${goal} is implemented with contract-required evidence and ready for protected-branch review.`,
    acceptanceCriteria: [
      `${goal} is implemented with the smallest coherent change`,
      ...requiredChecks.map((id) => `required check ${id} passes`),
      'an independent verifier passes',
      'staging smoke passes',
    ],
    risk: 'medium',
    requiredCapabilities: capabilities,
    responsibilities: [
      { role: 'builder_owner' },
      { role: 'independent_verifier' },
    ],
    approvalNeeds,
  }
}

export interface PlanPolicyViolation {
  action: string
  decision: PolicyDecision
  reason: string
  approvalRole?: string
}

/**
 * Validate a plan's declared approval needs against the contract. A plan is
 * not authority: if it asks for an action the contract denies or does not know
 * (`stop_and_request_decision`), the coordinator must raise a Decision Request
 * instead of scheduling work. `allow` and `require_approval` proceed — the
 * merge still stops at a human approval later.
 */
export function validatePlanPolicy(
  plan: RunPlan,
  contract: ProjectOperatingContract,
): { ok: true } | { ok: false; violation: PlanPolicyViolation } {
  for (const action of plan.approvalNeeds) {
    const { decision, policy } = decideAction(contract, action)
    if (decision === 'deny' || decision === 'stop_and_request_decision') {
      return {
        ok: false,
        violation: {
          action,
          decision,
          reason: policy?.reason ?? `action ${action} requires a human decision before it can run`,
          approvalRole: policy?.approvalRole,
        },
      }
    }
  }
  return { ok: true }
}

/** Stable content hash so a plan revision is comparable and auditable. */
export function planContentHash(plan: RunPlan): string {
  return sha256(canonicalJson(plan))
}
