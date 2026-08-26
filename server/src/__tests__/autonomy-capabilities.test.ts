import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isUnconstrained,
  KNOWN_CAPABILITIES,
  missingCapabilities,
  normalizeCapabilities,
} from '../autonomy/capabilities.js'

test('normalizeCapabilities trims, dedupes and drops non-strings', () => {
  assert.deepEqual(
    normalizeCapabilities(['repo:write', ' repo:write ', '', 'staging:deploy', 42, null]),
    ['repo:write', 'staging:deploy'],
  )
  assert.deepEqual(normalizeCapabilities('nope'), [])
  assert.deepEqual(normalizeCapabilities(undefined), [])
})

test('isUnconstrained treats empty/absent capability sets as unconstrained', () => {
  assert.equal(isUnconstrained(null), true)
  assert.equal(isUnconstrained(undefined), true)
  assert.equal(isUnconstrained([]), true)
  assert.equal(isUnconstrained(['repo:read']), false)
})

test('missingCapabilities returns the required capabilities a node lacks', () => {
  assert.deepEqual(
    missingCapabilities(['repo:write', 'staging:deploy'], ['repo:read', 'repo:write']),
    ['staging:deploy'],
  )
  assert.deepEqual(missingCapabilities(['repo:write'], ['repo:write', 'staging:deploy']), [])
  assert.deepEqual(missingCapabilities([], ['repo:read']), [])
})

test('KNOWN_CAPABILITIES covers the capabilities jobs currently require', () => {
  for (const capability of ['repo:read', 'repo:write', 'staging:deploy', 'production:deploy', 'production:read']) {
    assert.ok((KNOWN_CAPABILITIES as readonly string[]).includes(capability))
  }
})
