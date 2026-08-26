/**
 * Phase 1 of the four-layer agent architecture (see
 * docs/en/agent-mechanisms/08-agent-architecture-iteration-plan.md).
 *
 * A Run records BOTH the visible responsibility (which Persona is
 * accountable) and the actual executor (which Worker / Computer / Engine
 * ran it). These are the responsibilities an assignment row can carry.
 *
 * This module is intentionally pure (no DB, no side effects) so it can be
 * unit-tested and imported by both the coordinator and the API layer
 * without pulling in the pg pool.
 */

/** First-batch responsibilities. `builder_owner` and `independent_verifier`
 *  are the two that must never be the same identity for one Run. */
export const RUN_RESPONSIBILITIES = [
  'planner',
  'researcher',
  'builder_owner',
  'design_reviewer',
  'independent_verifier',
  'deployment_operator',
  'readback_operator',
] as const

export type RunResponsibility = (typeof RUN_RESPONSIBILITIES)[number]

export function isRunResponsibility(value: unknown): value is RunResponsibility {
  return typeof value === 'string' && (RUN_RESPONSIBILITIES as readonly string[]).includes(value)
}

/**
 * The responsibility a Run's execution binding fills, derived from its
 * `job_type`. The Control Plane records this automatically at claim time so
 * every Run answers "who executed this" from a server-issued identity rather
 * than a self-reported string.
 */
export function executionResponsibility(jobType: string): RunResponsibility {
  switch (jobType) {
    case 'deployment':
      return 'deployment_operator'
    case 'readback':
      return 'readback_operator'
    case 'verification':
      return 'independent_verifier'
    default:
      return 'builder_owner'
  }
}

/**
 * Project identity invariant #3: a builder owner cannot also be the
 * independent verifier for the same Run. Kept as a pure predicate so the
 * rule is testable and the coordinator/API share one definition.
 */
export function responsibilityConflictsIndependence(a: RunResponsibility, b: RunResponsibility): boolean {
  const pair = new Set<RunResponsibility>([a, b])
  return pair.has('builder_owner') && pair.has('independent_verifier')
}
