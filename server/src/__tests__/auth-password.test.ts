import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, verifyPassword } from '../auth.js'

test('password hashes verify and do not expose the original password', async () => {
  const password = 'a-random-admin-password-123'
  const encoded = await hashPassword(password)

  assert.match(encoded, /^scrypt:[^:]+:[^:]+$/)
  assert.notEqual(encoded, password)
  assert.equal(await verifyPassword(password, encoded), true)
  assert.equal(await verifyPassword('wrong-password', encoded), false)
  assert.equal(await verifyPassword(password, null), false)
})
