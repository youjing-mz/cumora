import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isReviewResponsibility,
  REVIEW_EVIDENCE_KIND,
  REVIEW_EVIDENCE_KINDS,
  REVIEW_RESPONSIBILITIES,
  requiresIndependence,
  reviewEvidenceKind,
} from '../autonomy/reviews.js'

test('REVIEW_RESPONSIBILITIES are the reviewer roles (not the executors)', () => {
  assert.deepEqual([...REVIEW_RESPONSIBILITIES], [
    'planner', 'researcher', 'design_reviewer', 'independent_verifier',
  ])
  assert.equal(isReviewResponsibility('design_reviewer'), true)
  assert.equal(isReviewResponsibility('builder_owner'), false)
  assert.equal(isReviewResponsibility('deployment_operator'), false)
  assert.equal(isReviewResponsibility('nope'), false)
})

test('reviewEvidenceKind maps each reviewer role to its evidence kind', () => {
  assert.equal(reviewEvidenceKind('design_reviewer'), 'design_review')
  // The independent verifier feeds the contract merge gate directly.
  assert.equal(reviewEvidenceKind('independent_verifier'), 'independent_verification')
  assert.equal(reviewEvidenceKind('researcher'), 'research')
  assert.equal(reviewEvidenceKind('planner'), 'plan_review')
  assert.deepEqual(new Set(REVIEW_EVIDENCE_KINDS), new Set(Object.values(REVIEW_EVIDENCE_KIND)))
})

test('only the independent verifier carries the builder≠verifier independence rule', () => {
  assert.equal(requiresIndependence('independent_verifier'), true)
  assert.equal(requiresIndependence('design_reviewer'), false)
  assert.equal(requiresIndependence('researcher'), false)
  assert.equal(requiresIndependence('planner'), false)
})
