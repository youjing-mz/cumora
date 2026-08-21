import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { _testing } from '../api/autonomy-github-webhook.js'

test('GitHub autonomy webhook uses exact-body sha256 HMAC', () => {
  const body = Buffer.from('{"action":"closed","pull_request":{"merged":true}}')
  const secret = 'webhook-test-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  assert.equal(_testing.validSignature(body, signature, secret), true)
  assert.equal(_testing.validSignature(Buffer.from(`${body.toString()} `), signature, secret), false)
  assert.equal(_testing.validSignature(body, 'sha256=wrong', secret), false)
})
