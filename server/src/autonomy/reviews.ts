/**
 * Phase 4 of the four-layer agent architecture (see
 * docs/en/agent-mechanisms/08-agent-architecture-iteration-plan.md).
 *
 * Persona-mediated review: a Persona that holds a review responsibility on a
 * Run (design reviewer, independent verifier, researcher, planner) submits a
 * STRUCTURED result — review evidence or a decision request — rather than
 * relying on chat. Chat stays context; only the structured submission, with a
 * server-verified producer identity, moves the Control Plane.
 *
 * Pure module (no DB) so the responsibility→evidence-kind mapping and its
 * guards are unit-tested and shared by the coordinator and API.
 */
import type { RunResponsibility } from './responsibilities.js'

/** The subset of responsibilities that review (as opposed to execute). The
 *  builder and the deployment/readback operators are executors, not reviewers. */
export const REVIEW_RESPONSIBILITIES = [
  'planner',
  'researcher',
  'design_reviewer',
  'independent_verifier',
] as const

export type ReviewResponsibility = (typeof REVIEW_RESPONSIBILITIES)[number]

export function isReviewResponsibility(value: unknown): value is ReviewResponsibility {
  return typeof value === 'string' && (REVIEW_RESPONSIBILITIES as readonly string[]).includes(value)
}

/** The evidence kind a given review responsibility produces. `independent_verifier`
 *  maps onto the contract's `independent_verification` gate so an assigned
 *  verifier Persona can satisfy the merge requirement with a server-verified
 *  identity. */
export const REVIEW_EVIDENCE_KIND: Record<ReviewResponsibility, string> = {
  planner: 'plan_review',
  researcher: 'research',
  design_reviewer: 'design_review',
  independent_verifier: 'independent_verification',
}

export function reviewEvidenceKind(responsibility: ReviewResponsibility): string {
  return REVIEW_EVIDENCE_KIND[responsibility]
}

/** All review evidence kinds — used to project reviews out of the evidence log. */
export const REVIEW_EVIDENCE_KINDS: readonly string[] = Object.values(REVIEW_EVIDENCE_KIND)

/** Only these responsibilities carry the builder≠verifier independence rule. */
export function requiresIndependence(responsibility: ReviewResponsibility): boolean {
  return responsibility === 'independent_verifier'
}

// Compile-time guard: every ReviewResponsibility is a RunResponsibility.
const _assertSubset: readonly RunResponsibility[] = REVIEW_RESPONSIBILITIES
void _assertSubset
