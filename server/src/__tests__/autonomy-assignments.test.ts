import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  executionResponsibility,
  isRunResponsibility,
  responsibilityConflictsIndependence,
  RUN_RESPONSIBILITIES,
} from '../autonomy/responsibilities.js'

test('RUN_RESPONSIBILITIES is the first-batch responsibility set', () => {
  assert.deepEqual([...RUN_RESPONSIBILITIES], [
    'planner',
    'researcher',
    'builder_owner',
    'design_reviewer',
    'independent_verifier',
    'deployment_operator',
    'readback_operator',
  ])
})

test('isRunResponsibility accepts known values and rejects everything else', () => {
  assert.equal(isRunResponsibility('builder_owner'), true)
  assert.equal(isRunResponsibility('independent_verifier'), true)
  assert.equal(isRunResponsibility('verifier'), false)
  assert.equal(isRunResponsibility('BUILDER_OWNER'), false)
  assert.equal(isRunResponsibility(''), false)
  assert.equal(isRunResponsibility(null), false)
  assert.equal(isRunResponsibility(42), false)
})

test('executionResponsibility maps job_type to the executor responsibility', () => {
  assert.equal(executionResponsibility('implementation'), 'builder_owner')
  assert.equal(executionResponsibility('deployment'), 'deployment_operator')
  assert.equal(executionResponsibility('readback'), 'readback_operator')
  assert.equal(executionResponsibility('verification'), 'independent_verifier')
  // Unknown job types default to the builder — the safest, most-gated slot.
  assert.equal(executionResponsibility('something-else'), 'builder_owner')
})

test('responsibilityConflictsIndependence only flags builder_owner vs independent_verifier', () => {
  assert.equal(responsibilityConflictsIndependence('builder_owner', 'independent_verifier'), true)
  assert.equal(responsibilityConflictsIndependence('independent_verifier', 'builder_owner'), true)
  assert.equal(responsibilityConflictsIndependence('builder_owner', 'design_reviewer'), false)
  assert.equal(responsibilityConflictsIndependence('planner', 'independent_verifier'), false)
  assert.equal(responsibilityConflictsIndependence('builder_owner', 'builder_owner'), false)
})
